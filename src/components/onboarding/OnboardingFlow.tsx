
import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  User, 
  GraduationCap, 
  Target, 
  BookOpen, 
  Clock, 
  Star,
  Calendar,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Camera,
  Upload
} from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { ChooseSubjectsStep } from './ChooseSubjectsStep';
import { supabase } from '@/integrations/supabase/client';
import { trackOnboardingCompleted } from '@/api/analyticsAPI';
import { IS_EXAM_MODE_GATED } from '@/config/featureGates';
import { ExamModeComingSoon } from '@/components/common/ExamModeComingSoon';

interface OnboardingData {
  name: string;
  age: string;
  avatarUrl?: string;
  learningMode: 'college' | 'exam' | '';
  subjects: string[];
  examType?: string;
  targetYear?: string;
  degree?: string;
  course?: string;
  semester?: string;
  academicYear?: string;
  university?: string;
  college?: string;
  studyPreference: string[];
  motivation: string[];
  dailyHours: string;
  reviewModes: string[];
  email: string;
  studyReminder?: string;
}

const STEPS = [
  'Welcome & Identity',
  'Profile Photo',
  'Learning Mode & Context',
  'Academic Details',
  'Choose Your Subjects',
  'Complete Profile'
];

export const OnboardingFlow = ({
  initialStep = 0,
  initialData = {},
}: {
  initialStep?: number;
  initialData?: Partial<OnboardingData>;
} = {}) => {
  const navigate = useNavigate();
  const { updateUserType, user } = useAuth();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [isLoading, setIsLoading] = useState(false);
  const [showExamComingSoon, setShowExamComingSoon] = useState(false);
  const [data, setData] = useState<OnboardingData>({
    name: '',
    age: '',
    learningMode: '',
    subjects: [],
    studyPreference: [],
    motivation: [],
    dailyHours: '',
    reviewModes: [],
    email: user?.email || '',
    ...initialData,
  });

  const examTypes = [
    'NEET (Medical)', 'JEE (Engineering)', 'UPSC (Civil Services)', 
    'GATE (Graduate Aptitude)', 'CUET (Common University)', 'Bank/SSC', 
    'CAT (MBA)', 'CLAT (Law)', 'Other'
  ];

  const degrees = [
    'B.Tech / B.E.', 'B.Sc.', 'B.A.', 'B.Com / BBA', 'BCA / MCA', 'M.Tech / M.Sc.', 'Other'
  ];

  const courses = [
    'BTech (Computer Science)', 'BTech (Mechanical)', 'BTech (Electrical)', 
    'BTech (Civil)', 'BSc (Biology)', 'BSc (Physics)', 'BSc (Chemistry)',
    'BA (Economics)', 'BA (English)', 'BBA', 'BCom', 'Other'
  ];

  const reviewModes = [
    'Flashcards', 'Mind Maps', 'Practice Quizzes', 'Summary Notes', 
    'Mock Tests', 'Video Tutorials'
  ];

  const handleNext = () => {
    if (currentStep === 2 && data.learningMode === 'exam' && IS_EXAM_MODE_GATED) {
      setShowExamComingSoon(true);
      return;
    }
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleArrayToggle = (field: keyof OnboardingData, value: string) => {
    setData(prev => ({
      ...prev,
      [field]: Array.isArray(prev[field])
        ? (prev[field] as string[]).includes(value)
          ? (prev[field] as string[]).filter(item => item !== value)
          : [...(prev[field] as string[]), value]
        : [value]
    }));
  };

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setData(prev => ({ ...prev, avatarUrl: e.target?.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleComplete = async () => {
    setIsLoading(true);
    try {
      // Temporary hackathon gate: ensure College Mode is enforced if exam mode was somehow active
      const userType = (IS_EXAM_MODE_GATED && data.learningMode === 'exam')
        ? 'college'
        : data.learningMode;
      
      // Validate required fields
      if (!userType || !data.name) {
        throw new Error('Missing required information');
      }

      const details: any = {
        name: data.name.trim(),
        age: data.age,
        avatarUrl: data.avatarUrl,
        subjects: data.subjects,
        studyPreference: data.studyPreference || [],
        motivation: data.motivation || [],
        dailyHours: data.dailyHours || '3-4',
        reviewModes: data.reviewModes || [],
        email: data.email,
        studyReminder: data.studyReminder
      };

      if (userType === 'exam') {
        details.examType = data.examType || 'Competitive Exam';
        details.targetYear = data.targetYear;
      } else {
        details.college = data.college || 'College / University';
        details.university = data.university;
        details.degree = data.degree;
        details.academicYear = data.academicYear;
        details.course = data.course || 'Undergraduate';
        details.semester = parseInt(data.semester || '1', 10);
      }

      console.log('OnboardingFlow: Completing onboarding with details:', details);
      
      // 1. Immediately save subjects locally so vault and dashboard have them immediately
      localStorage.setItem('studymate_selected_subjects', JSON.stringify(data.subjects));

      // 2. Persist profile state & sync to cloud
      await updateUserType(userType as 'exam' | 'college', details);

      // 3. Best-effort background batch insertion into subjects table (non-blocking)
      void (async () => {
        try {
          const { data: authData } = await supabase.auth.getUser();
          if (authData?.user && data.subjects.length > 0) {
            const subjectsToInsert = data.subjects.map((name) => ({
              name,
              user_id: authData.user.id,
              total_topics: 10,
              completed_topics: 0,
            }));
            await supabase.from('subjects').insert(subjectsToInsert);
          }
        } catch (err) {
          console.warn('Could not batch-insert into subjects table (profile subjects will be used):', err);
        }
      })();
      
      toast({
        title: "Welcome to Ming AI! 🎉",
        description: "Your personalized learning journey begins now!",
      });

      // 4. Record product telemetry
      void trackOnboardingCompleted({
        learningMode: userType,
        subjectsCount: data.subjects?.length || 0,
        academicDetails: details,
      }).catch((e) => console.warn('Could not track onboarding completion:', e));

      // 5. Guaranteed direct redirect to dashboard
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Onboarding completion error:', error);
      toast({
        title: "Setup Error",
        description: "Failed to complete setup. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: return data.name && data.age;
      case 1: return true; // Avatar is optional
      case 2: return !!data.learningMode;
      case 3: 
        if (data.learningMode === 'exam') {
          return data.examType && data.targetYear;
        } else {
          return data.semester && data.course;
        }
      case 4: return data.subjects && data.subjects.length > 0;
      case 5: return Boolean(data.email);
      default: return true;
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <User className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-foreground mb-3">Welcome to Ming AI!</h2>
              <p className="text-lg text-muted-foreground">Let's get to know you better to personalize your experience</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label htmlFor="name" className="text-base font-medium">What's your full name? *</Label>
                <Input
                  id="name"
                  value={data.name}
                  onChange={(e) => setData({...data, name: e.target.value})}
                  placeholder="Enter your full name"
                  className="mt-2 h-12 text-base"
                />
              </div>
              <div>
                <Label className="text-base font-medium">How old are you? *</Label>
                <Select value={data.age} onValueChange={(value) => setData({...data, age: value})}>
                  <SelectTrigger className="mt-2 h-12">
                    <SelectValue placeholder="Select your age range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="13-16">13-16 years</SelectItem>
                    <SelectItem value="17-20">17-20 years</SelectItem>
                    <SelectItem value="21-25">21-25 years</SelectItem>
                    <SelectItem value="26-30">26-30 years</SelectItem>
                    <SelectItem value="30+">30+ years</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                <Camera className="w-10 h-10 text-primary-foreground" />
              </div>
              <h2 className="font-serif text-3xl font-bold text-foreground mb-3">Add Your Profile Photo</h2>
              <p className="text-lg text-muted-foreground">Make your profile more personal (optional)</p>
            </div>

            <div className="flex flex-col items-center space-y-6">
              <Avatar className="w-32 h-32 border-4 border-border shadow-md">
                {data.avatarUrl ? (
                  <AvatarImage src={data.avatarUrl} alt="Profile" />
                ) : (
                  <AvatarFallback className="text-2xl font-bold bg-brand-gradient text-white">
                    {data.name ? getInitials(data.name) : 'U'}
                  </AvatarFallback>
                )}
              </Avatar>

              <div className="text-center">
                <input
                  type="file"
                  id="avatar-upload"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <label
                  htmlFor="avatar-upload"
                  className="inline-flex items-center px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg cursor-pointer transition-all duration-200 shadow-sm"
                >
                  <Upload className="w-5 h-5 mr-2" />
                  Upload Photo
                </label>
                <p className="text-sm text-muted-foreground mt-2">JPG, PNG or GIF (max 5MB)</p>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-foreground mb-3">What describes your learning journey?</h2>
              <p className="text-lg text-muted-foreground">This helps us customize your dashboard and features</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <Card 
                className={`p-8 cursor-pointer transition-all duration-300 hover:shadow-xl ${
                  data.learningMode === 'college' 
                    ? 'border-blue-500 bg-blue-500/10 shadow-lg ring-2 ring-blue-500/30' 
                    : 'hover:border-blue-400/50 bg-card hover:shadow-lg border-border'
                }`}
                onClick={() => setData({...data, learningMode: 'college'})}
              >
                <div className="text-center">
                  <GraduationCap className="w-16 h-16 text-blue-600 dark:text-blue-400 mx-auto mb-4" />
                  <h3 className="font-bold text-xl mb-3 text-foreground">College Student</h3>
                  <p className="text-muted-foreground leading-relaxed">Building skills, managing coursework, working on projects, and preparing for your career</p>
                </div>
              </Card>

              <Card 
                className={`p-8 cursor-pointer transition-all duration-300 hover:shadow-xl relative ${
                  data.learningMode === 'exam' 
                    ? 'border-emerald-500 bg-emerald-500/10 shadow-lg ring-2 ring-emerald-500/30' 
                    : 'hover:border-emerald-400/50 bg-card hover:shadow-lg border-border'
                }`}
                onClick={() => {
                  if (IS_EXAM_MODE_GATED) {
                    setShowExamComingSoon(true);
                  } else {
                    setData({...data, learningMode: 'exam'});
                  }
                }}
              >
                <div className="text-center">
                  {IS_EXAM_MODE_GATED && (
                    <div className="flex items-center justify-center gap-1.5 mb-2">
                      <Badge 
                        variant="outline" 
                        className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs font-semibold uppercase tracking-wider"
                      >
                        <Clock className="w-3 h-3 mr-1 inline" />
                        Coming Soon
                      </Badge>
                    </div>
                  )}
                  <Target className="w-16 h-16 text-emerald-600 dark:text-emerald-400 mx-auto mb-4" />
                  <h3 className="font-bold text-xl mb-3 text-foreground">Exam Preparation</h3>
                  <p className="text-muted-foreground leading-relaxed">Focused preparation for competitive exams like JEE, NEET, UPSC, GATE, and more</p>
                </div>
              </Card>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-foreground mb-3">Tell us about your academic details</h2>
              <p className="text-lg text-muted-foreground">This helps us create the perfect study plan for you</p>
            </div>

            {data.learningMode === 'exam' ? (
              <div className="space-y-6">
                <div>
                  <Label className="text-base font-medium">Which exam are you preparing for? *</Label>
                  <Select value={data.examType} onValueChange={(value) => setData({...data, examType: value})}>
                    <SelectTrigger className="mt-2 h-12">
                      <SelectValue placeholder="Select your target exam" />
                    </SelectTrigger>
                    <SelectContent>
                      {examTypes.map((exam) => (
                        <SelectItem key={exam} value={exam}>{exam}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-base font-medium">What is your target year? *</Label>
                  <Select value={data.targetYear} onValueChange={(value) => setData({...data, targetYear: value})}>
                    <SelectTrigger className="mt-2 h-12">
                      <SelectValue placeholder="Select target year" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2025">2025</SelectItem>
                      <SelectItem value="2026">2026</SelectItem>
                      <SelectItem value="2027">2027</SelectItem>
                      <SelectItem value="2028">2028</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <Label className="text-base font-medium">What degree are you pursuing?</Label>
                  <Select
                    value={data.degree || 'B.Tech / B.E.'}
                    onValueChange={(value) => setData({ ...data, degree: value })}
                  >
                    <SelectTrigger className="mt-2 h-12">
                      <SelectValue placeholder="Select degree" />
                    </SelectTrigger>
                    <SelectContent>
                      {degrees.map((deg) => (
                        <SelectItem key={deg} value={deg}>{deg}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-base font-medium">What is your course/branch? *</Label>
                  <Select value={data.course} onValueChange={(value) => setData({...data, course: value})}>
                    <SelectTrigger className="mt-2 h-12">
                      <SelectValue placeholder="Select your course" />
                    </SelectTrigger>
                    <SelectContent>
                      {courses.map((course) => (
                        <SelectItem key={course} value={course}>{course}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-base font-medium">Current Semester *</Label>
                    <Select
                      value={data.semester}
                      onValueChange={(value) => {
                        const semNum = parseInt(value, 10);
                        const yr = Math.ceil(semNum / 2);
                        const yrSuffix = yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th';
                        const yrLabel = `${yr}${yrSuffix} Year`;
                        setData({ ...data, semester: value, academicYear: yrLabel });
                      }}
                    >
                      <SelectTrigger className="mt-2 h-12">
                        <SelectValue placeholder="Select semester" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => {
                          const yr = Math.ceil(sem / 2);
                          const yrSuffix = yr === 1 ? 'st' : yr === 2 ? 'nd' : yr === 3 ? 'rd' : 'th';
                          return (
                            <SelectItem key={sem} value={sem.toString()}>
                              Semester {sem} ({yr}{yrSuffix} Year)
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-base font-medium">Academic Year</Label>
                    <Input
                      value={data.academicYear || (data.semester ? `${Math.ceil(parseInt(data.semester, 10) / 2)} Year` : '1st Year')}
                      readOnly
                      className="mt-2 h-12 bg-muted/40 font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-base font-medium">University / Board (Optional)</Label>
                    <Input
                      value={data.university || ''}
                      onChange={(e) => setData({ ...data, university: e.target.value })}
                      placeholder="e.g., Delhi University, VTU, Anna Univ"
                      className="mt-2 h-12"
                    />
                  </div>
                  <div>
                    <Label className="text-base font-medium">College / Institute (Optional)</Label>
                    <Input
                      value={data.college || ''}
                      onChange={(e) => setData({ ...data, college: e.target.value })}
                      placeholder="e.g., IIT Delhi, MIT, BITS Pilani"
                      className="mt-2 h-12"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 4:
        return (
          <ChooseSubjectsStep
            learningMode={data.learningMode}
            university={data.university}
            college={data.college}
            degree={data.degree}
            course={data.course}
            semester={data.semester}
            academicYear={data.academicYear}
            examType={data.examType}
            targetYear={data.targetYear}
            selectedSubjects={data.subjects}
            onChange={(newSubjects) => {
              setData((prev) => ({ ...prev, subjects: newSubjects }));
            }}
          />
        );

      case 5:
        return (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg">
                <CheckCircle className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-foreground mb-3">Complete your profile</h2>
              <p className="text-lg text-muted-foreground">Just a few more details to get started</p>
            </div>

            <div className="space-y-6">
              <div>
                <Label htmlFor="email" className="text-base font-medium">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={data.email}
                  onChange={(e) => setData({...data, email: e.target.value})}
                  placeholder="Enter your email address"
                  className="mt-2 h-12"
                />
              </div>
              <div>
                <Label htmlFor="reminder" className="text-base font-medium">Daily Study Reminder (Optional)</Label>
                <Input
                  id="reminder"
                  type="time"
                  value={data.studyReminder || ''}
                  onChange={(e) => setData({...data, studyReminder: e.target.value})}
                  className="mt-2 h-12"
                />
                <p className="text-sm text-muted-foreground mt-2">We'll send you a gentle reminder to study</p>
              </div>
            </div>

            <div className="bg-secondary/60 p-6 rounded-xl border border-border">
              <h3 className="font-serif font-bold text-foreground mb-4 text-lg">Your Profile Summary:</h3>
              <div className="text-sm text-foreground space-y-3">
                <div className="flex items-center space-x-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span><strong>Name:</strong> {data.name}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <BookOpen className="w-4 h-4 text-muted-foreground" />
                  <span><strong>Mode:</strong> {data.learningMode === 'college' ? 'College Student' : 'Exam Preparation'}</span>
                </div>
                {data.subjects && data.subjects.length > 0 && (
                  <div className="flex items-start space-x-2 pt-1 border-t border-border/50">
                    <Target className="w-4 h-4 mt-0.5 text-[#20B486] shrink-0" />
                    <div>
                      <span className="block font-semibold mb-1">
                        Selected Subjects ({data.subjects.length}):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {data.subjects.map((sub) => (
                          <span
                            key={sub}
                            className="inline-block px-2.5 py-1 text-xs bg-emerald-100/80 dark:bg-emerald-950/60 text-[#063B2A] dark:text-emerald-300 rounded-lg font-medium border border-emerald-300/40 dark:border-emerald-800/40"
                          >
                            {sub}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (showExamComingSoon) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-accent/30 via-background to-accent/20 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl animate-fade-in-up">
          <ExamModeComingSoon
            onGoToCollegeMode={() => {
              setData(prev => ({ ...prev, learningMode: 'college' }));
              setShowExamComingSoon(false);
              setCurrentStep(3);
            }}
            onBack={() => {
              setShowExamComingSoon(false);
            }}
            backLabel="Back to mode selection"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-accent/30 via-background to-accent/20 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl animate-fade-in-up">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-semibold text-foreground">
              Step {currentStep + 1} of {STEPS.length}
            </span>
            <span className="text-sm text-muted-foreground font-medium">{STEPS[currentStep]}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 shadow-inner">
            <div 
              className="bg-brand-gradient h-3 rounded-full transition-all duration-500 ease-out shadow-sm"
              style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Main Card */}
        <Card className="p-8 lg:p-12 glass-strong shadow-premium-lg rounded-2xl">
          {renderStep()}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-10">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentStep === 0}
              className="flex items-center px-6 h-12 border-2"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous
            </Button>

            {currentStep === STEPS.length - 1 ? (
              <Button
                onClick={handleComplete}
                disabled={!canProceed() || isLoading}
                variant="success"
                size="lg"
                className="flex items-center"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Creating your profile...
                  </>
                ) : (
                  <>
                    Complete Setup
                    <Star className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleNext}
                disabled={!canProceed()}
                variant="premium"
                size="lg"
                className="flex items-center"
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </Card>

        {/* Help Text */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Don't worry! You can always change these preferences later in your settings
          </p>
        </div>
      </div>
    </div>
  );
};
