-- Fix missing study_materials table
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/cmcbkatdyhunlvlktwlv/sql

-- Create study_materials table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.study_materials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('flashcards', 'notes', 'mindmaps', 'quizzes', 'diagrams')),
  topic TEXT,
  difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
  tags TEXT[],
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
); 

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_study_materials_user_id ON public.study_materials(user_id);
CREATE INDEX IF NOT EXISTS idx_study_materials_type ON public.study_materials(type);
CREATE INDEX IF NOT EXISTS idx_study_materials_created_at ON public.study_materials(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.study_materials ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own study materials" ON public.study_materials;
DROP POLICY IF EXISTS "Users can create their own study materials" ON public.study_materials;
DROP POLICY IF EXISTS "Users can update their own study materials" ON public.study_materials;
DROP POLICY IF EXISTS "Users can delete their own study materials" ON public.study_materials;

-- Create RLS policies
CREATE POLICY "Users can view their own study materials"
  ON public.study_materials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own study materials"
  ON public.study_materials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own study materials"
  ON public.study_materials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own study materials"
  ON public.study_materials FOR DELETE
  USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON public.study_materials TO authenticated;
GRANT ALL ON public.study_materials TO service_role;
