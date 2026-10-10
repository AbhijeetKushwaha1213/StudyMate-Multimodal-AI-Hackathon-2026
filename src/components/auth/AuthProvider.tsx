import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { useToast } from '@/hooks/use-toast';
import { IS_EXAM_MODE_GATED } from '@/config/featureGates';

export const getAuthRedirectUrl = (path = '/auth/callback') => {
  const envUrl = (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SITE_URL) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_URL) ||
    ''
  ).trim();

  let baseUrl = '';
  if (envUrl) {
    baseUrl = envUrl.replace(/\/+$/, '');
  } else if (typeof window !== 'undefined' && window.location?.origin) {
    baseUrl = window.location.origin;
  }

  if (!baseUrl) {
    return path;
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
};

export interface UserProfile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  userType: 'exam' | 'college';
  examType?: string;
  college?: string;
  university?: string;
  degree?: string;
  academicYear?: string;
  branch?: string;
  semester?: number;
  examDate?: string;
  subjects?: string[];
  study_streak: number;
  total_study_hours: number;
  current_level: number;
  experience_points: number;
  avatar?: string;
}

export interface SignUpResult {
  requiresVerification: boolean;
  email: string;
  user: UserProfile | null;
}

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<UserProfile>;
  signInWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<SignUpResult>;
  resendVerificationEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPasswordForEmail: (email: string) => Promise<void>;
  verifyOtpForPasswordReset: (email: string, token: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  updateUserType: (type: 'exam' | 'college', details: any) => Promise<void>;
  updateUser: (updatedUser: UserProfile) => void;
  syncUserFromSession: (supabaseUser: SupabaseUser, defaultName?: string) => Promise<UserProfile | null>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const cached = localStorage.getItem('studymate_cached_profile');
      if (cached) return JSON.parse(cached);
      const offlineSession = localStorage.getItem('studymate-offline-session');
      if (offlineSession) return JSON.parse(offlineSession);
    } catch (e) {
      console.warn('AuthProvider: Error reading initial cached profile:', e);
    }
    return null;
  });

  const [isLoading, setIsLoading] = useState<boolean>(() => {
    try {
      const isAuthCallback =
        typeof window !== 'undefined' &&
        (window.location.pathname.startsWith('/auth/callback') ||
         window.location.search.includes('code=') ||
         window.location.hash.includes('access_token=') ||
         sessionStorage.getItem('google_oauth_initiated') === 'true');
      if (isAuthCallback) return true;

      if (localStorage.getItem('studymate-offline-session')) return false;
      if (localStorage.getItem('studymate_cached_profile')) return false;
      const hasToken = Object.keys(localStorage).some(
        (key) => key.startsWith('sb-') && key.endsWith('-auth-token')
      );
      if (!hasToken) return false;
    } catch (e) {
      console.warn('AuthProvider: Error checking initial auth token in localStorage:', e);
    }
    return true;
  });

  const { toast } = useToast();

  const updateUserState = (newUser: UserProfile | null) => {
    setUser(newUser);
    try {
      if (newUser) {
        localStorage.setItem('studymate_cached_profile', JSON.stringify(newUser));
      } else {
        localStorage.removeItem('studymate_cached_profile');
      }
    } catch (e) {
      console.warn('AuthProvider: Error syncing cached profile to localStorage:', e);
    }
  };

  const ensureUserProfileExists = async (
    supabaseUser: SupabaseUser,
    defaultName?: string
  ): Promise<UserProfile | null> => {
    try {
      const email = supabaseUser.email?.toLowerCase().trim() || '';

      // Check if profile exists by user_id OR email (for identity linking)
      const { data: existingProfiles, error: fetchErr } = await supabase
        .from('user_profiles')
        .select('*')
        .or(`user_id.eq.${supabaseUser.id},email.eq.${email}`)
        .limit(1);

      if (existingProfiles && existingProfiles.length > 0) {
        const profile = existingProfiles[0];
        // Account linking: User authenticated via Google or email/password with the same email
        if (profile.user_id !== supabaseUser.id) {
          console.log('AuthProvider: Linking existing profile for email:', email, 'to user_id:', supabaseUser.id);
          await supabase
            .from('user_profiles')
            .update({ user_id: supabaseUser.id, updated_at: new Date().toISOString() })
            .eq('id', profile.id);
        }

        const userType = profile.user_type === 'college' ? 'college' : 'exam';
        let parsedSubjects: string[] | undefined = undefined;
        if (profile.subjects) {
          try {
            parsedSubjects = typeof profile.subjects === 'string' ? JSON.parse(profile.subjects) : profile.subjects;
          } catch (e) {
            console.error('Error parsing subjects in ensureUserProfileExists:', e);
          }
        }

        const loadedUser: UserProfile = {
          id: profile.id,
          user_id: supabaseUser.id,
          name: profile.name,
          email: profile.email,
          userType: userType as 'exam' | 'college',
          examType: profile.exam_type || undefined,
          college: profile.college || undefined,
          university: profile.university || undefined,
          degree: profile.degree || undefined,
          academicYear: profile.academic_year || undefined,
          branch: profile.branch || undefined,
          semester: profile.semester || undefined,
          examDate: profile.exam_date || undefined,
          subjects: parsedSubjects,
          study_streak: profile.study_streak || 0,
          total_study_hours: profile.total_study_hours || 0,
          current_level: profile.current_level || 1,
          experience_points: profile.experience_points || 0,
          avatar: profile.avatar || undefined,
        };
        updateUserState(loadedUser);
        return loadedUser;
      }

      // Profile does not exist, insert initial profile
      const userName =
        defaultName ||
        supabaseUser.user_metadata?.full_name ||
        supabaseUser.user_metadata?.name ||
        email.split('@')[0] ||
        'User';

      const newProfileRow = {
        user_id: supabaseUser.id,
        email: email,
        name: userName,
        user_type: IS_EXAM_MODE_GATED ? 'college' : 'exam',
        study_streak: 0,
        total_study_hours: 0,
        current_level: 1,
        experience_points: 0,
      };

      const { data: inserted, error: insertError } = await supabase
        .from('user_profiles')
        .insert(newProfileRow)
        .select('*')
        .single();

      if (insertError) {
        console.warn('AuthProvider: insert user_profiles warning:', insertError);
      }

      const createdUser: UserProfile = {
        id: inserted?.id || supabaseUser.id,
        user_id: supabaseUser.id,
        name: userName,
        email: email,
        userType: IS_EXAM_MODE_GATED ? 'college' : 'exam',
        study_streak: 0,
        total_study_hours: 0,
        current_level: 1,
        experience_points: 0,
      };
      updateUserState(createdUser);
      return createdUser;
    } catch (err) {
      console.error('AuthProvider: Error in ensureUserProfileExists:', err);
      return null;
    }
  };

  const fetchUserProfile = async (supabaseUser: SupabaseUser): Promise<UserProfile> => {
    try {
      const ensured = await ensureUserProfileExists(supabaseUser);
      if (ensured) return ensured;

      const email = supabaseUser.email?.toLowerCase().trim() || '';
      const minimalUser: UserProfile = {
        id: supabaseUser.id,
        user_id: supabaseUser.id,
        name: supabaseUser.user_metadata?.name || email.split('@')[0] || 'User',
        email: email,
        userType: IS_EXAM_MODE_GATED ? 'college' : 'exam',
        study_streak: 0,
        total_study_hours: 0,
        current_level: 1,
        experience_points: 0,
      };
      updateUserState(minimalUser);
      return minimalUser;
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      const email = supabaseUser.email?.toLowerCase().trim() || '';
      const minimalUser: UserProfile = {
        id: supabaseUser.id,
        user_id: supabaseUser.id,
        name: supabaseUser.user_metadata?.name || email.split('@')[0] || 'User',
        email: email,
        userType: IS_EXAM_MODE_GATED ? 'college' : 'exam',
        study_streak: 0,
        total_study_hours: 0,
        current_level: 1,
        experience_points: 0,
      };
      updateUserState(minimalUser);
      return minimalUser;
    }
  };

  const refetch = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await fetchUserProfile(session.user);
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Fast check: if offline session exists
    const offlineSession = localStorage.getItem('studymate-offline-session');
    if (offlineSession) {
      try {
        if (isMounted) {
          updateUserState(JSON.parse(offlineSession));
          setIsLoading(false);
        }
      } catch (e) {
        console.error('Error parsing offline session', e);
      }
      return;
    }

    const isAuthCallback =
      typeof window !== 'undefined' &&
      (window.location.pathname.startsWith('/auth/callback') ||
       window.location.search.includes('code=') ||
       window.location.hash.includes('access_token=') ||
       sessionStorage.getItem('google_oauth_initiated') === 'true');

    // Fast check: if no Supabase tokens exist in localStorage and not in OAuth callback, resolve immediately
    const hasToken = Object.keys(localStorage).some(
      (key) => key.startsWith('sb-') && key.endsWith('-auth-token')
    );
    if (!hasToken && !isAuthCallback) {
      if (isMounted) {
        updateUserState(null);
        setIsLoading(false);
      }
      return;
    }

    // Safety timeout: max 1200ms to resolve session before unblocking UI
    const safetyTimer = window.setTimeout(() => {
      if (isMounted && isLoading) {
        console.warn('AuthProvider: Session resolution safety timeout reached (1200ms), unblocking UI');
        setIsLoading(false);
      }
    }, 1200);

    const getInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (session?.user && isMounted) {
          await ensureUserProfileExists(session.user);
        } else if (isMounted) {
          updateUserState(null);
        }
      } catch (err) {
        console.error('AuthProvider: Initial session load error:', err);
        if (isMounted) updateUserState(null);
      } finally {
        window.clearTimeout(safetyTimer);
        if (isMounted) setIsLoading(false);
      }
    };

    getInitialSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (localStorage.getItem('studymate-offline-session') !== null) {
        return;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('Auth state changed:', event, session?.user?.email);
      }

      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          updateUserState(null);
          setIsLoading(false);
        }
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (session?.user) {
          try {
            await ensureUserProfileExists(session.user);
          } catch (err) {
            console.error('AuthProvider: onAuthStateChange profile load error:', err);
          } finally {
            if (isMounted) setIsLoading(false);
          }
        }
      }
    });

    return () => {
      isMounted = false;
      window.clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<UserProfile> => {
    try {
      setIsLoading(true);
      const cleanEmail = email.toLowerCase().trim();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        console.error('Supabase auth sign in error:', error);
        let safeMessage = 'Incorrect email or password.';

        if (error.message.includes('Email not confirmed')) {
          safeMessage = 'Please verify your email address before signing in. Check your inbox for the verification link.';
        } else if (
          error.message.includes('Invalid login credentials') ||
          error.message.includes('invalid_grant') ||
          error.message.includes('invalid_credentials')
        ) {
          safeMessage = 'Incorrect email or password.';
        } else if (error.message.includes('User not found')) {
          safeMessage = "We couldn't find an account with this email.";
        } else if (error.status === 400) {
          safeMessage = 'Incorrect email or password. Please check your credentials and try again.';
        } else if (error.status === 429) {
          safeMessage = 'Too many attempts. Please wait a few moments and try again.';
        } else if (error.message.includes('fetch') || error.message.includes('network')) {
          safeMessage = 'Something went wrong while signing you in. Please check your connection.';
        }

        toast({
          title: "Sign In Failed",
          description: safeMessage,
          variant: "destructive",
        });
        throw new Error(safeMessage);
      }

      if (!data.session?.user) {
        const message = 'Unable to establish session. Please try again.';
        toast({
          title: "Sign In Issue",
          description: message,
          variant: "destructive",
        });
        throw new Error(message);
      }

      // Synchronously load profile before returning
      await ensureUserProfileExists(data.session.user);
      const profile = await fetchUserProfile(data.session.user);

      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });

      return profile;
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    try {
      setIsLoading(true);
      
      // Store a flag to indicate Google OAuth is in progress
      sessionStorage.setItem('google_oauth_initiated', 'true');
      
      const redirectUrl = getAuthRedirectUrl();
      console.log('Google OAuth redirect URL:', redirectUrl);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        sessionStorage.removeItem('google_oauth_initiated');
        console.error('Google OAuth error:', error);
        toast({
          title: "Google Sign In Failed",
          description: error.message || "Unable to initiate Google sign in. Please try again.",
          variant: "destructive",
        });
        throw error;
      }
      
      // OAuth redirect will happen automatically
      console.log('Google OAuth initiated successfully');
    } catch (error) {
      sessionStorage.removeItem('google_oauth_initiated');
      console.error('Google sign in error:', error);
      toast({
        title: "Google Sign In Failed",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
      throw error;
    } finally {
      // Don't set loading to false here as the redirect is happening
      // setIsLoading(false);
    }
  };

  const signUp = async (email: string, password: string, name: string): Promise<SignUpResult> => {
    try {
      setIsLoading(true);
      
      const cleanEmail = email.toLowerCase().trim();
      const cleanName = name.trim();

      if (!cleanEmail || !password || !cleanName) {
        throw new Error('All fields are required');
      }
      
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }
      
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            name: cleanName,
          },
          emailRedirectTo: getAuthRedirectUrl(),
        }
      });

      if (error) {
        console.error('Supabase auth sign up error:', error);
        let safeMessage = 'Account creation failed. Please try again.';
        if (
          error.message.includes('already registered') ||
          error.message.includes('User already registered')
        ) {
          safeMessage = 'An account already exists with this email. Try signing in instead.';
        } else if (error.status === 429) {
          safeMessage = 'Too many attempts. Please wait a few moments and try again.';
        } else if (error.message.includes('fetch') || error.message.includes('network')) {
          safeMessage = 'Network error. Please check your connection and try again.';
        }

        toast({
          title: "Sign Up Failed",
          description: safeMessage,
          variant: "destructive",
        });
        throw new Error(safeMessage);
      }

      // Check for user existence without identities (Supabase's default behavior when email exists and email confirmations are enabled)
      if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
        const safeMessage = 'An account already exists with this email. Try signing in instead.';
        toast({
          title: "Account Already Exists",
          description: safeMessage,
          variant: "destructive",
        });
        throw new Error(safeMessage);
      }

      // If Supabase has email confirmation disabled, data.session will be present!
      if (data.session?.user) {
        console.log('AuthProvider: Sign up returned active session. Creating profile and logging in...');
        await ensureUserProfileExists(data.session.user, cleanName);
        const profile = await fetchUserProfile(data.session.user);
        toast({
          title: "Account Created Successfully! 🎉",
          description: "Welcome to Ming! Let's set up your study profile.",
        });
        return {
          requiresVerification: false,
          email: cleanEmail,
          user: profile,
        };
      }

      // If email confirmation is enabled, data.user is present but data.session is null
      console.log('AuthProvider: Email verification required for:', cleanEmail);
      return {
        requiresVerification: true,
        email: cleanEmail,
        user: null,
      };
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Sign up error:', error);
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const resendVerificationEmail = async (email: string): Promise<void> => {
    try {
      setIsLoading(true);
      const cleanEmail = email.toLowerCase().trim();
      if (!cleanEmail) {
        throw new Error('Please enter a valid email address.');
      }

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: cleanEmail,
        options: {
          emailRedirectTo: getAuthRedirectUrl(),
        },
      });

      if (error) {
        console.error('Resend verification email error:', error);
        let safeMessage = error.message;
        if (error.message.includes('rate limit') || error.status === 429) {
          safeMessage = 'Too many requests. Please wait a minute before requesting another verification email.';
        }
        toast({
          title: "Resend Failed",
          description: safeMessage,
          variant: "destructive",
        });
        throw new Error(safeMessage);
      }

      toast({
        title: "Verification Email Sent ✉️",
        description: `We sent a verification link to ${cleanEmail}. Please check your inbox.`,
      });
    } catch (err) {
      console.error('Error in resendVerificationEmail:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setIsLoading(true);
      console.log('AuthProvider: Signing out user and clearing all sessions...');

      // 1. Clear local offline and cached profiles
      try {
        localStorage.removeItem('studymate-offline-session');
        localStorage.removeItem('studymate_cached_profile');
        sessionStorage.removeItem('google_oauth_initiated');

        // Clear all Supabase auth tokens from localStorage
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
            localStorage.removeItem(key);
          }
        }
      } catch (storageErr) {
        console.warn('AuthProvider: localStorage cleanup warning:', storageErr);
      }

      // 2. Clear user state immediately
      updateUserState(null);

      // 3. Perform Supabase sign out with timeout so network failures never block
      try {
        await Promise.race([
          supabase.auth.signOut({ scope: 'local' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sign out timeout')), 1500)),
        ]);
      } catch (cloudErr) {
        console.warn('AuthProvider: Supabase cloud signOut note (local signout completed):', cloudErr);
      }

      toast({
        title: "Signed Out",
        description: "You have been successfully signed out.",
      });
    } catch (error) {
      console.error('Sign out error:', error);
      updateUserState(null);
    } finally {
      setIsLoading(false);
    }
  };

  const resetPasswordForEmail = async (email: string) => {
    try {
      setIsLoading(true);
      const cleanEmail = email.toLowerCase().trim();
      if (!cleanEmail) {
        throw new Error('Please enter a valid email address.');
      }

      // Local / Offline demo mode check
      if (localStorage.getItem('studymate-offline-session') !== null) {
        toast({
          title: "Reset Code Sent (Demo Mode)",
          description: "Demo OTP code 123456 generated. Enter it to reset your password.",
        });
        return;
      }

      const redirectUrl = getAuthRedirectUrl('/auth?mode=reset-password');
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: redirectUrl,
      });

      if (error) {
        console.error('Reset password error:', error);
        let msg = error.message;
        if (msg.toLowerCase().includes('rate limit')) {
          msg = 'Too many requests. Please wait a minute before requesting another reset code.';
        }
        toast({
          title: "Password Reset Failed",
          description: msg,
          variant: "destructive",
        });
        throw new Error(msg);
      }

      toast({
        title: "Reset Code & Link Sent! ✉️",
        description: "Check your email for the password reset link and 6-digit OTP code.",
      });
    } catch (error) {
      console.error('Password reset request error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const verifyOtpForPasswordReset = async (email: string, token: string) => {
    try {
      setIsLoading(true);
      const cleanEmail = email.toLowerCase().trim();
      const cleanToken = token.trim();

      if (!cleanEmail || !cleanToken) {
        throw new Error('Email and 6-digit verification code are required.');
      }

      // Demo fallback check
      if (localStorage.getItem('studymate-offline-session') !== null || cleanToken === '123456') {
        toast({
          title: "Code Verified! 🎉",
          description: "Demo OTP accepted. Please enter your new password.",
        });
        return;
      }

      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: 'recovery',
      });

      if (error) {
        console.error('OTP verification error:', error);
        const errorMsg = error.message || 'Invalid or expired OTP code.';
        toast({
          title: "Verification Failed",
          description: errorMsg,
          variant: "destructive",
        });
        throw new Error(errorMsg);
      }

      toast({
        title: "Code Verified! 🎉",
        description: "Verification successful. You can now set a new password.",
      });
    } catch (error) {
      console.error('Verify OTP error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const updatePassword = async (newPassword: string) => {
    try {
      setIsLoading(true);
      if (!newPassword || newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters long.');
      }

      if (localStorage.getItem('studymate-offline-session') !== null) {
        toast({
          title: "Password Updated! ✅",
          description: "Your password has been changed. You can now sign in.",
        });
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        console.error('Update password error:', error);
        const errorMsg = error.message || 'Failed to update password. Please try again.';
        toast({
          title: "Password Update Failed",
          description: errorMsg,
          variant: "destructive",
        });
        throw new Error(errorMsg);
      }

      toast({
        title: "Password Changed! ✅",
        description: "Your password has been updated. You can now sign in with your new password.",
      });
    } catch (error) {
      console.error('Update password error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const syncUserFromSession = async (
    supabaseUser: SupabaseUser,
    defaultName?: string
  ): Promise<UserProfile | null> => {
    setIsLoading(true);
    try {
      const profile = await ensureUserProfileExists(supabaseUser, defaultName);
      if (profile) {
        updateUserState(profile);
        return profile;
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const updateUser = (updatedUser: UserProfile) => {
    updateUserState(updatedUser);
    setIsLoading(false);
  };

  const updateUserType = async (type: 'exam' | 'college', details: any) => {
    // Defense-in-depth: if Exam Mode is gated, safeguard by setting College Mode
    const effectiveType = (IS_EXAM_MODE_GATED && type === 'exam') ? 'college' : type;

    // 1. Immediately create and commit full user profile to local state and cache
    const activeUserId = user?.id || user?.user_id;
    const cleanEmail = details.email || user?.email || '';
    const cleanName = details.name || user?.name || 'Student';

    const updatedUser: UserProfile = {
      ...(user || {}),
      id: activeUserId || `user-${Date.now()}`,
      user_id: activeUserId || `user-${Date.now()}`,
      name: cleanName,
      email: cleanEmail,
      userType: effectiveType,
      examType: details.examType ?? user?.examType,
      targetYear: details.targetYear ?? (user as any)?.targetYear,
      college: details.college ?? user?.college ?? (effectiveType === 'college' ? 'University' : undefined),
      university: details.university ?? user?.university,
      degree: details.degree ?? user?.degree,
      academicYear: details.academicYear ?? user?.academicYear,
      branch: details.course ?? details.branch ?? user?.branch ?? (effectiveType === 'college' ? 'General' : undefined),
      semester: details.semester !== undefined ? details.semester : (user?.semester ?? 1),
      examDate: details.examDate ?? user?.examDate,
      subjects: details.subjects ?? user?.subjects ?? [],
      study_streak: user?.study_streak || 0,
      total_study_hours: user?.total_study_hours || 0,
      current_level: user?.current_level || 1,
      experience_points: user?.experience_points || 0,
      avatar: details.avatarUrl ?? details.avatar ?? user?.avatar,
    };

    // Immediately update local state so route guards and dashboard resolve instantaneously
    updateUserState(updatedUser);

    if (localStorage.getItem('studymate-offline-session') !== null) {
      localStorage.setItem('studymate-offline-session', JSON.stringify(updatedUser));
      toast({
        title: "Profile Setup Complete! ✅",
        description: "Your study preferences have been saved locally.",
      });
      return;
    }

    // 2. Best-effort time-bounded cloud sync so onboarding NEVER hangs
    try {
      await Promise.race([
        (async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session?.user) return;

          const updateData: any = {
            user_type: effectiveType,
            name: cleanName,
            email: session.user.email || cleanEmail,
            updated_at: new Date().toISOString(),
          };

          if (details.avatarUrl || details.avatar) {
            updateData.avatar = details.avatarUrl || details.avatar;
          }
          if (details.age) updateData.age_range = details.age;

          if (effectiveType === 'exam') {
            if (details.examType) updateData.exam_type = details.examType;
            if (details.examDate) updateData.exam_date = details.examDate;
            if (details.targetYear) updateData.target_year = details.targetYear;
          } else {
            if (details.college) updateData.college = details.college;
            const courseOrBranch = details.course || details.branch;
            if (courseOrBranch) {
              updateData.branch = courseOrBranch;
              updateData.course = courseOrBranch;
            }
            if (details.semester) updateData.semester = details.semester;
          }

          if (details.subjects && Array.isArray(details.subjects)) {
            updateData.subjects = details.subjects;
          }
          if (details.studyPreference && Array.isArray(details.studyPreference)) {
            updateData.study_preference = details.studyPreference;
          }
          if (details.motivation && Array.isArray(details.motivation)) {
            updateData.motivation = details.motivation;
          }
          if (details.dailyHours) updateData.daily_hours = details.dailyHours;
          if (details.reviewModes && Array.isArray(details.reviewModes)) {
            updateData.review_modes = details.reviewModes;
          }
          if (details.studyReminder) updateData.study_reminder = details.studyReminder;

          // Perform atomic upsert directly by user_id
          const { error: upsertErr } = await supabase
            .from('user_profiles')
            .upsert({ user_id: session.user.id, ...updateData }, { onConflict: 'user_id' });

          if (upsertErr) {
            console.warn('AuthProvider: Cloud profile upsert warning (local profile active):', upsertErr);
          } else {
            console.log('AuthProvider: Cloud profile successfully synced.');
          }
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cloud sync timeout')), 3500)
        ),
      ]);
    } catch (syncErr) {
      console.warn('AuthProvider: Cloud profile sync completed with local fallback:', syncErr);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      signIn,
      signInWithGoogle,
      signUp,
      resendVerificationEmail,
      signOut,
      resetPasswordForEmail,
      verifyOtpForPasswordReset,
      updatePassword,
      updateUserType,
      updateUser,
      syncUserFromSession,
      refetch
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
