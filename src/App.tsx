import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./components/auth/AuthProvider";
import { AuthCallback } from "./components/auth/AuthCallback";
import { MainApp } from "./components/MainApp";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import {
  ProtectedRoute,
  OnboardingRoute,
  PublicAuthRoute,
  RootRedirectRoute,
} from "./components/auth/RouteGuards";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SecurityHeaders } from "./components/security/SecurityHeaders";
import { GeminiQuotaExceededModal } from "./components/ai/GeminiQuotaExceededModal";
import NotFound from "./pages/NotFound";
import React, { Suspense, lazy } from "react";

const Landing = lazy(() => import("./pages/Landing"));
const EvaluationDashboard = lazy(() =>
  import("./components/dev/EvaluationDashboard").then((m) => ({ default: m.EvaluationDashboard })),
);
const ExamModeRoute = lazy(() => import("./pages/ExamModeRoute"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error && typeof error === 'object' && 'status' in error) {
          const status = (error as any).status;
          if (status >= 400 && status < 500) {
            return false;
          }
        }
        return failureCount < 3;
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

export const App = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SecurityHeaders />
          <Toaster />
          <Sonner />
          <GeminiQuotaExceededModal />
          <BrowserRouter>
            <AuthProvider>
              <Suspense
                fallback={
                  <div className="min-h-screen flex items-center justify-center bg-background">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  </div>
                }
              >
                <Routes>
                  {/* Root Route: Deterministic routing based on session */}
                  <Route path="/" element={<RootRedirectRoute />} />

                  {/* Public Marketing Landing Page */}
                  <Route path="/landing" element={<Landing />} />

                  {/* Public Authentication Views */}
                  <Route path="/login" element={<PublicAuthRoute initialTab="signin" />} />
                  <Route path="/signup" element={<PublicAuthRoute initialTab="signup" />} />
                  <Route path="/auth" element={<PublicAuthRoute initialTab="signin" />} />

                  {/* OAuth Callback Controller */}
                  <Route path="/auth/callback" element={<AuthCallback />} />

                  {/* Authenticated Onboarding Route */}
                  <Route
                    path="/onboarding"
                    element={
                      <OnboardingRoute>
                        <OnboardingFlow />
                      </OnboardingRoute>
                    }
                  />

                  {/* Protected Main Dashboard */}
                  <Route
                    path="/dashboard"
                    element={
                      <ProtectedRoute>
                        <MainApp />
                      </ProtectedRoute>
                    }
                  />

                  {/* Protected Exam Mode Routes (Gated with Coming Soon for Hackathon Demo) */}
                  <Route
                    path="/exam"
                    element={
                      <ProtectedRoute>
                        <ExamModeRoute />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/exam-prep"
                    element={
                      <ProtectedRoute>
                        <ExamModeRoute />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/exam-mode"
                    element={
                      <ProtectedRoute>
                        <ExamModeRoute />
                      </ProtectedRoute>
                    }
                  />

                  {/* Development & Diagnostics */}
                  <Route path="/dev/evaluation" element={<EvaluationDashboard />} />

                  {/* 404 Fallback */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
