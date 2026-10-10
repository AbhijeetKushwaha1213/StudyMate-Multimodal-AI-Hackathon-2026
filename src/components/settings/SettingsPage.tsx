
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { IntegrationsSettings } from './IntegrationsSettings';
import { PasswordChangeForm } from './PasswordChangeForm';
import { supabase } from '@/integrations/supabase/client';
import { LogOut } from 'lucide-react';
import { IS_EXAM_MODE_GATED } from '@/config/featureGates';
import { ExamModeComingSoon } from '@/components/common/ExamModeComingSoon';

export const SettingsPage = ({ defaultTab = 'profile' }: { defaultTab?: string }) => {
  const { user, updateUserType, updateUser, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showExamComingSoon, setShowExamComingSoon] = useState(false);
  const [selectedType, setSelectedType] = useState(user?.userType || 'college');
  const [examType, setExamType] = useState(user?.examType || '');
  const [college, setCollege] = useState(user?.college || '');
  const [semester, setSemester] = useState<number | undefined>(user?.semester);
  const [isNotificationsEnabled, setIsNotificationsEnabled] = useState(true);
  const [isDarkModeEnabled, setIsDarkModeEnabled] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
    }
  }, [user]);

  // Apply dark mode to document
  useEffect(() => {
    if (isDarkModeEnabled) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', isDarkModeEnabled.toString());
  }, [isDarkModeEnabled]);

  const handleProfileUpdate = async () => {
    if (!user) return;
    
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          name: name,
          email: email
        })
        .eq('user_id', user.user_id);

      if (error) {
        throw error;
      }

      // Update local state
      updateUser({ ...user, name, email });

      toast({
        title: "Profile Updated",
        description: "Your profile has been successfully updated.",
      });
    } catch (error) {
      console.error("Profile update failed:", error);
      toast({
        title: "Update Failed",
        description: "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStudyPreferenceUpdate = async () => {
    if (IS_EXAM_MODE_GATED && selectedType === 'exam') {
      // Validate before persisting: Exam Mode is gated for hackathon demo.
      // Do not save unsupported mode, do not show false success message.
      setShowExamComingSoon(true);
      return;
    }

    setIsSubmitting(true);
    try {
      await updateUserType(selectedType as 'exam' | 'college', { examType, college, semester });
      toast({
        title: "Study Preferences Updated",
        description: "Your study preferences have been saved.",
      });
    } catch (error) {
      console.error("Study preferences update failed:", error);
      toast({
        title: "Update Failed",
        description: "Failed to update study preferences. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUserTypeChange = (value: string) => {
    if (value === 'exam' || value === 'college') {
      setSelectedType(value);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      console.error('SettingsPage: Sign out error:', err);
    } finally {
      setIsSigningOut(false);
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="text-2xl font-bold text-gradient">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="study">Study Preferences</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="privacy">Privacy & Security</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="space-y-6">
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">Profile Information</h2>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your Name"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Your Email"
                    disabled
                  />
                </div>
                <Button onClick={handleProfileUpdate} disabled={isSubmitting}>
                  {isSubmitting ? "Updating..." : "Update Profile"}
                </Button>
              </div>
            </Card>

            <Card className="p-6 border-destructive/20 bg-destructive/5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground">Sign Out</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Securely sign out of your Ming AI account on this device.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="shrink-0 gap-2 shadow-sm"
                >
                  <LogOut className="w-4 h-4" />
                  {isSigningOut ? "Signing Out..." : "Sign Out"}
                </Button>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="study">
          {showExamComingSoon ? (
            <ExamModeComingSoon
              onGoToCollegeMode={async () => {
                setSelectedType('college');
                setIsSubmitting(true);
                try {
                  await updateUserType('college', {
                    college: college || user?.college || 'College / University',
                    semester: semester || user?.semester || 1,
                  });
                  setShowExamComingSoon(false);
                  toast({
                    title: "Study Preferences Updated",
                    description: "Switched to College Mode. Your preferences have been saved.",
                  });
                } catch (error) {
                  console.error("Failed to restore College Mode in settings:", error);
                  toast({
                    title: "Update Failed",
                    description: "Failed to save College Mode preferences.",
                    variant: "destructive",
                  });
                } finally {
                  setIsSubmitting(false);
                }
              }}
              onBack={() => {
                setSelectedType(user?.userType === 'exam' ? 'college' : (user?.userType || 'college'));
                setShowExamComingSoon(false);
              }}
              backLabel="Back to Settings"
              isLoading={isSubmitting}
            />
          ) : (
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">Study Preferences</h2>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="userType">I am a...</Label>
                  <Select value={selectedType} onValueChange={handleUserTypeChange}>
                    <SelectTrigger id="userType">
                      <SelectValue placeholder="Select your type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exam">
                        Exam Aspirant {IS_EXAM_MODE_GATED ? '(Coming Soon)' : ''}
                      </SelectItem>
                      <SelectItem value="college">College Student</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedType === 'exam' && (
                  <div>
                    <Label htmlFor="examType">Preparing for...</Label>
                    <Input
                      type="text"
                      id="examType"
                      value={examType}
                      onChange={(e) => setExamType(e.target.value)}
                      placeholder="e.g., JEE, NEET, UPSC"
                    />
                  </div>
                )}

                {selectedType === 'college' && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="collegeName">College Name</Label>
                      <Input
                        type="text"
                        id="collegeName"
                        value={college}
                        onChange={(e) => setCollege(e.target.value)}
                        placeholder="e.g., IIT Bombay"
                      />
                    </div>
                    <div>
                      <Label htmlFor="semester">Semester</Label>
                      <Select value={semester?.toString()} onValueChange={(value) => setSemester(parseInt(value))}>
                        <SelectTrigger id="semester">
                          <SelectValue placeholder="Select semester" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Semester 1</SelectItem>
                          <SelectItem value="2">Semester 2</SelectItem>
                          <SelectItem value="3">Semester 3</SelectItem>
                          <SelectItem value="4">Semester 4</SelectItem>
                          <SelectItem value="5">Semester 5</SelectItem>
                          <SelectItem value="6">Semester 6</SelectItem>
                          <SelectItem value="7">Semester 7</SelectItem>
                          <SelectItem value="8">Semester 8</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <Button onClick={handleStudyPreferenceUpdate} disabled={isSubmitting}>
                  {isSubmitting ? "Updating..." : "Update Preferences"}
                </Button>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="notifications">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Notification Settings</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="notifications">Enable Notifications</Label>
                <Switch
                  id="notifications"
                  checked={isNotificationsEnabled}
                  onCheckedChange={setIsNotificationsEnabled}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Stay updated with study reminders, achievements, and important announcements.
              </p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="privacy" className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Privacy & Security</h2>
            <PasswordChangeForm />
          </Card>

          <Card className="p-6 border-destructive/20 bg-destructive/5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Sign Out</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Securely sign out of your Ming AI account on this device.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="shrink-0 gap-2 shadow-sm"
              >
                <LogOut className="w-4 h-4" />
                {isSigningOut ? "Signing Out..." : "Sign Out"}
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationsSettings />
        </TabsContent>

        <TabsContent value="appearance">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Appearance</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="darkMode">Dark Mode</Label>
                <Switch
                  id="darkMode"
                  checked={isDarkModeEnabled}
                  onCheckedChange={setIsDarkModeEnabled}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                Toggle between light and dark mode for a comfortable viewing experience.
              </p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
