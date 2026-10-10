import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { IS_EXAM_MODE_GATED, isExamModeSupported } from '@/config/featureGates';
import { ExamModeComingSoon } from '@/components/common/ExamModeComingSoon';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { ContentRenderer } from '@/components/layout/ContentRenderer';
import { ExamModeRoute } from '@/pages/ExamModeRoute';

// Mock pointer capture for Radix UI components in JSDOM
window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'mock-user-123' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

// Mock Analytics
vi.mock('@/api/analyticsAPI', () => ({
  trackOnboardingCompleted: vi.fn().mockResolvedValue(undefined),
}));

// Mock Toasts
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock AuthProvider functions
const mockUpdateUserType = vi.fn();
const mockUpdateUser = vi.fn();
const mockSignOut = vi.fn();
let currentAuthUser: any = {
  id: 'user-1',
  user_id: 'user-1',
  name: 'Alex Student',
  email: 'alex@example.com',
  userType: 'college',
  college: 'Tech University',
  semester: 4,
  study_streak: 5,
  total_study_hours: 12,
  current_level: 2,
  experience_points: 250,
};

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: currentAuthUser,
    isAuthenticated: true,
    isLoading: false,
    updateUserType: mockUpdateUserType,
    updateUser: mockUpdateUser,
    signOut: mockSignOut,
  }),
}));

// Mock College and Exam Dashboards for lightweight rendering test
vi.mock('@/components/dashboard/CollegeDashboard', () => ({
  CollegeDashboard: () => <div data-testid="college-dashboard">College Dashboard Content</div>,
}));

vi.mock('@/components/dashboard/ExamDashboard', () => ({
  ExamDashboard: () => <div data-testid="exam-dashboard">Exam Dashboard Content</div>,
}));

describe('Ming Hackathon Gate: Exam Preparation Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentAuthUser = {
      id: 'user-1',
      user_id: 'user-1',
      name: 'Alex Student',
      email: 'alex@example.com',
      userType: 'college',
      college: 'Tech University',
      semester: 4,
      study_streak: 5,
      total_study_hours: 12,
      current_level: 2,
      experience_points: 250,
    };
  });

  describe('1. Feature Gate Configuration Integrity', () => {
    it('isExamModeSupported returns false while gated for hackathon demo', () => {
      expect(IS_EXAM_MODE_GATED).toBe(true);
      expect(isExamModeSupported()).toBe(false);
    });
  });

  describe('2. Reusable ExamModeComingSoon Component', () => {
    it('renders heading, coming soon badge, description, and primary/secondary actions', () => {
      const handleCollege = vi.fn();
      const handleBack = vi.fn();

      render(
        <ExamModeComingSoon
          onGoToCollegeMode={handleCollege}
          onBack={handleBack}
          backLabel="Back to mode selection"
        />
      );

      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();
      expect(screen.getByText(/Coming Soon/i)).toBeDefined();
      expect(screen.getByText(/We're working on a more complete exam preparation experience/i)).toBeDefined();
      expect(screen.getByText(/Targeted Syllabi/i)).toBeDefined();
      expect(screen.getByText(/Mock Assessments/i)).toBeDefined();
      expect(screen.getByText(/Revision Cycles/i)).toBeDefined();

      const collegeBtn = screen.getByRole('button', { name: /Continue with College Mode/i });
      expect(collegeBtn).toBeDefined();
      fireEvent.click(collegeBtn);
      expect(handleCollege).toHaveBeenCalledTimes(1);

      const backBtn = screen.getByRole('button', { name: /Back to mode selection/i });
      expect(backBtn).toBeDefined();
      fireEvent.click(backBtn);
      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. First-Time Onboarding Flow', () => {
    it('shows Coming Soon when Exam Preparation is clicked, allows returning to mode selection and continuing with College Mode', async () => {
      render(
        <MemoryRouter>
          <OnboardingFlow
            initialStep={2}
            initialData={{ name: 'Sam Rivera', age: '17-20' }}
          />
        </MemoryRouter>
      );

      // Step 2: Learning Mode & Context
      expect(screen.getByText(/What describes your learning journey\?/i)).toBeDefined();
      const examCard = screen.getByText(/Exam Preparation/i);
      expect(examCard).toBeDefined();

      // Click Exam card -> triggers Coming Soon
      fireEvent.click(examCard);

      // Verify Coming Soon screen is displayed immediately
      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();
      expect(screen.getByText(/Coming Soon/i)).toBeDefined();
      expect(mockUpdateUserType).not.toHaveBeenCalled();

      // Click "Back to mode selection"
      const backBtn = screen.getByRole('button', { name: /Back to mode selection/i });
      fireEvent.click(backBtn);

      // Should return to Step 2
      expect(screen.getByText(/What describes your learning journey\?/i)).toBeDefined();

      // Click College Student card
      const collegeCard = screen.getByText(/College Student/i);
      fireEvent.click(collegeCard);

      // Continue to Step 3: Academic Details
      const nextBtn = screen.getByRole('button', { name: /Continue/i });
      fireEvent.click(nextBtn);

      // Now at Academic details for College Student
      expect(screen.getByText(/Tell us about your academic details/i)).toBeDefined();
    });

    it('navigates directly to College Mode when "Go to College Mode" is chosen from Coming Soon', async () => {
      render(
        <MemoryRouter>
          <OnboardingFlow
            initialStep={2}
            initialData={{ name: 'Taylor Lee', age: '21-25' }}
          />
        </MemoryRouter>
      );

      // Click Exam Preparation card
      fireEvent.click(screen.getByText(/Exam Preparation/i));
      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();

      // Click "Go to College Mode"
      const goToCollegeBtn = screen.getByRole('button', { name: /Continue with College Mode/i });
      fireEvent.click(goToCollegeBtn);

      // Should advance directly to Step 3 for College Student
      expect(screen.getByText(/Tell us about your academic details/i)).toBeDefined();
      expect(screen.getByText(/What degree are you pursuing\?/i)).toBeDefined();
    });
  });

  describe('4. Settings Preference Change Behavior', () => {
    it('persists College Mode with success toast when saved in Settings', async () => {
      render(
        <MemoryRouter>
          <SettingsPage defaultTab="study" />
        </MemoryRouter>
      );

      // Click Update Preferences
      const updateBtn = screen.getByRole('button', { name: /Update Preferences/i });
      fireEvent.click(updateBtn);

      await waitFor(() => {
        expect(mockUpdateUserType).toHaveBeenCalledWith('college', expect.anything());
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Study Preferences Updated',
          })
        );
      });
    });

    it('intercepts Exam Mode selection on save: does NOT persist exam mode, shows Coming Soon, allows returning or saving College Mode', async () => {
      // Initialize with exam selected
      currentAuthUser = {
        ...currentAuthUser,
        userType: 'exam',
      };

      render(
        <MemoryRouter>
          <SettingsPage defaultTab="study" />
        </MemoryRouter>
      );

      // Click Update Preferences with exam mode
      const updateBtn = screen.getByRole('button', { name: /Update Preferences/i });
      fireEvent.click(updateBtn);

      // Should NOT have called updateUserType with exam
      expect(mockUpdateUserType).not.toHaveBeenCalled();

      // Coming Soon notice should appear in the tab
      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();
      expect(screen.getByText(/Coming Soon/i)).toBeDefined();

      // Test "Back to Settings"
      const backBtn = screen.getByRole('button', { name: /Back to Settings/i });
      fireEvent.click(backBtn);

      // Restores standard study preferences view
      expect(screen.getByRole('heading', { level: 2, name: /Study Preferences/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Update Preferences/i })).toBeDefined();
    });

    it('allows one-click save of College Mode from Coming Soon in Settings', async () => {
      currentAuthUser = {
        ...currentAuthUser,
        userType: 'exam',
      };

      render(
        <MemoryRouter>
          <SettingsPage defaultTab="study" />
        </MemoryRouter>
      );

      // Click Update Preferences to open Coming Soon
      fireEvent.click(screen.getByRole('button', { name: /Update Preferences/i }));
      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();

      // Click "Go to College Mode"
      const collegeBtn = screen.getByRole('button', { name: /Continue with College Mode/i });
      fireEvent.click(collegeBtn);

      await waitFor(() => {
        expect(mockUpdateUserType).toHaveBeenCalledWith('college', expect.anything());
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Study Preferences Updated',
            description: expect.stringContaining('College Mode'),
          })
        );
      });
    });
  });

  describe('5. Dashboard Content Routing & Gate Protection', () => {
    it('renders CollegeDashboard normally when userType is college', () => {
      currentAuthUser = {
        ...currentAuthUser,
        userType: 'college',
      };

      render(<ContentRenderer activeTab="home" />);
      expect(screen.getByTestId('college-dashboard')).toBeDefined();
      expect(screen.queryByTestId('exam-dashboard')).toBeNull();
    });

    it('renders ExamModeComingSoon instead of ExamDashboard when userType is exam while gated', () => {
      currentAuthUser = {
        ...currentAuthUser,
        userType: 'exam',
      };

      render(<ContentRenderer activeTab="home" />);
      expect(screen.queryByTestId('exam-dashboard')).toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();
      expect(screen.getByText(/Coming Soon/i)).toBeDefined();
    });

    it('clicking "Go to College Mode" from ContentRenderer gates calls updateUserType with college', async () => {
      currentAuthUser = {
        ...currentAuthUser,
        userType: 'exam',
      };

      render(<ContentRenderer activeTab="home" />);
      const collegeBtn = screen.getByRole('button', { name: /Continue with College Mode/i });
      fireEvent.click(collegeBtn);

      await waitFor(() => {
        expect(mockUpdateUserType).toHaveBeenCalledWith('college', expect.objectContaining({
          college: expect.any(String),
          semester: expect.any(Number),
        }));
      });
    });
  });

  describe('6. Direct URL Route Protection (ExamModeRoute)', () => {
    it('direct route renders ExamModeComingSoon and navigates back without redirect loops', async () => {
      currentAuthUser = {
        ...currentAuthUser,
        userType: 'exam',
      };

      render(
        <MemoryRouter>
          <ExamModeRoute />
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();
      expect(screen.getByText(/Coming Soon/i)).toBeDefined();

      // Click "Go to Dashboard"
      const backBtn = screen.getByRole('button', { name: /Go to Dashboard/i });
      fireEvent.click(backBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });

      // Click "Go to College Mode"
      const collegeBtn = screen.getByRole('button', { name: /Continue with College Mode/i });
      fireEvent.click(collegeBtn);

      await waitFor(() => {
        expect(mockUpdateUserType).toHaveBeenCalledWith('college', expect.anything());
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
      });
    });
  });

  describe('7. Legacy Profile Preservation & Non-Mutation', () => {
    it('does not silently overwrite or mutate existing exam preference in memory/DB upon rendering', () => {
      currentAuthUser = {
        ...currentAuthUser,
        userType: 'exam',
      };

      render(<ContentRenderer activeTab="home" />);

      // Coming Soon must be rendered
      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();

      // Crucial: No updateUserType or profile update calls were triggered automatically
      expect(mockUpdateUserType).not.toHaveBeenCalled();
      expect(mockUpdateUser).not.toHaveBeenCalled();
      // The user object itself was not mutated
      expect(currentAuthUser.userType).toBe('exam');
    });

    it('clicking "Back to Settings" triggers zero database/profile update calls and restores the form', () => {
      currentAuthUser = {
        ...currentAuthUser,
        userType: 'college',
      };

      render(
        <MemoryRouter>
          <SettingsPage defaultTab="study" />
        </MemoryRouter>
      );

      // Trigger gate by saving exam preference
      const updateBtn = screen.getByRole('button', { name: /Update Preferences/i });
      fireEvent.click(updateBtn); // default is college, let's switch to exam first
      expect(mockUpdateUserType).toHaveBeenCalledTimes(1);
      mockUpdateUserType.mockClear();

      // Now set currentAuthUser to exam
      currentAuthUser = { ...currentAuthUser, userType: 'exam' };
      const { unmount } = render(
        <MemoryRouter>
          <SettingsPage defaultTab="study" />
        </MemoryRouter>
      );

      // In the second render, selectedType starts as exam, click update
      const updateBtns = screen.getAllByRole('button', { name: /Update Preferences/i });
      fireEvent.click(updateBtns[updateBtns.length - 1]);

      // Coming Soon appears
      expect(screen.getByRole('heading', { level: 1, name: /Exam Preparation Mode/i })).toBeDefined();

      // Click "Back to Settings"
      const backBtn = screen.getByRole('button', { name: /Back to Settings/i });
      fireEvent.click(backBtn);

      // Verify no updateUserType or save action was called
      expect(mockUpdateUserType).not.toHaveBeenCalled();
      unmount();
    });
  });
});
