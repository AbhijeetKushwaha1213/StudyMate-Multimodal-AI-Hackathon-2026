import React from 'react';
import { CollegeDashboard } from '../dashboard/CollegeDashboard';
import { ExamDashboard } from '../dashboard/ExamDashboard';
import { AIGeneratorPage } from '../flashcards/AIGeneratorPage';
import { AIChat } from '../chat/AIChat';
import { ProfilePage } from '../profile/ProfilePage';
import { SettingsPage } from '../settings/SettingsPage';
import { NewAchievementsPage } from '../achievements/NewAchievementsPage';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { DiscoverResources } from '../discover/DiscoverResources';
import { IntegrationsPage } from '../integrations/IntegrationsPage';
import { useAuth } from '../auth/AuthProvider';
import { NotionResourceManager } from '../notion/NotionResourceManager';
import { VideoLearningPage } from '../video/VideoLearningPage';
import { IS_EXAM_MODE_GATED } from '@/config/featureGates';
import { ExamModeComingSoon } from '../common/ExamModeComingSoon';

interface ContentRendererProps {
  activeTab: string;
  onNavigate?: (tab: string) => void;
}

export const ContentRenderer = ({ activeTab, onNavigate }: ContentRendererProps) => {
  const { user, updateUserType } = useAuth();

  const handleNavigate = (tab: string) => {
    if (onNavigate) {
      onNavigate(tab);
    }
  };

  const renderHomeDashboard = () => {
    if (user?.userType === 'college') {
      return <CollegeDashboard />;
    }

    if (IS_EXAM_MODE_GATED) {
      // Temporary hackathon gate: Legacy user or session with exam preference
      // displays Coming Soon screen with one-click path to College Mode.
      return (
        <div className="flex-1 w-full flex items-center justify-center p-4">
          <ExamModeComingSoon
            onGoToCollegeMode={async () => {
              await updateUserType('college', {
                college: user?.college || 'College / University',
                semester: user?.semester || 1,
                course: user?.branch || 'Undergraduate',
              });
            }}
            onBack={() => handleNavigate('settings')}
            backLabel="Go to Settings"
          />
        </div>
      );
    }

    return <ExamDashboard />;
  };

  const renderContent = () => {
    console.log('ContentRenderer: Rendering activeTab:', activeTab);
    
    switch (activeTab) {
      case 'home':
        return renderHomeDashboard();
      case 'flashcards':
        return <AIGeneratorPage />;
      case 'ai':
        return <AIChat />;
      case 'achievements':
        return <NewAchievementsPage />;
      case 'profile':
        return <ProfilePage />;
      case 'settings':
        return <SettingsPage />;
      case 'integrations':
        return <IntegrationsPage />;
      case 'resources':
        return <NotionResourceManager />;
      case 'video-learning':
        return <VideoLearningPage />;
      case 'notifications':
        return <NotificationCenter onNavigate={handleNavigate} />;
      case 'discover':
        return <DiscoverResources onNavigate={handleNavigate} />;
      default:
        console.log('ContentRenderer: Unknown tab, rendering default dashboard');
        return renderHomeDashboard();
    }
  };

  return (
    <div className="flex-1 w-full flex flex-col min-h-0">
      {renderContent()}
    </div>
  );
};
