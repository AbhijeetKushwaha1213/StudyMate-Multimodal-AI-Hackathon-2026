import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/components/auth/AuthProvider';
import { IS_EXAM_MODE_GATED } from '@/config/featureGates';
import { ExamModeComingSoon } from '@/components/common/ExamModeComingSoon';
import { ExamDashboard } from '@/components/dashboard/ExamDashboard';

/**
 * Ming — Dedicated Exam Mode Direct Route Handler
 * 
 * Protects direct access to routes such as /exam, /exam-prep, and /exam-mode.
 * 
 * TEMPORARY HACKATHON BEHAVIOR:
 * When IS_EXAM_MODE_GATED is true, displays the polished ExamModeComingSoon experience
 * instead of exposing partially developed exam features.
 * 
 * When IS_EXAM_MODE_GATED is false, renders the full ExamDashboard.
 */
export const ExamModeRoute: React.FC = () => {
  const { user, updateUserType } = useAuth();
  const navigate = useNavigate();

  if (!IS_EXAM_MODE_GATED) {
    return <ExamDashboard />;
  }

  const handleGoToCollegeMode = async () => {
    if (user && user.userType !== 'college') {
      try {
        await updateUserType('college', {
          college: user.college || 'College / University',
          semester: user.semester || 1,
          course: user.branch || 'Undergraduate',
        });
      } catch (err) {
        console.warn('Could not update user type to college from ExamModeRoute:', err);
      }
    }
    navigate('/dashboard', { replace: true });
  };

  const handleBack = () => {
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <ExamModeComingSoon
        onGoToCollegeMode={handleGoToCollegeMode}
        onBack={handleBack}
        backLabel="Go to Dashboard"
      />
    </div>
  );
};

export default ExamModeRoute;
