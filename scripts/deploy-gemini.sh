#!/bin/bash

echo "🚀 Deploying Gemini AI Assistant to Supabase"
echo "=============================================="
echo ""

# Check if GEMINI_API_KEY is provided
if [ -z "$1" ]; then
    echo "❌ Error: Gemini API key not provided"
    echo ""
    echo "Usage: ./scripts/deploy-gemini.sh YOUR_GEMINI_API_KEY"
    echo ""
    echo "To get a Gemini API key:"
    echo "1. Visit: https://makersuite.google.com/app/apikey"
    echo "2. Sign in with your Google account"
    echo "3. Click 'Create API Key'"
    echo "4. Copy the key and run this script again"
    echo ""
    exit 1
fi

GEMINI_API_KEY=$1

echo "Step 1: Setting Gemini API key in Supabase..."
supabase secrets set GEMINI_API_KEY="$GEMINI_API_KEY"

if [ $? -ne 0 ]; then
    echo "❌ Failed to set API key"
    exit 1
fi

echo "✅ API key set successfully"
echo ""

echo "Step 2: Deploying ai-assistant edge function..."
supabase functions deploy ai-assistant --no-verify-jwt

if [ $? -ne 0 ]; then
    echo "❌ Failed to deploy function"
    exit 1
fi

echo "✅ Function deployed successfully"
echo ""

echo "🎉 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Restart your dev server: npm run dev"
echo "2. Test the AI chat or flashcard generation"
echo "3. Check browser console for any errors"
echo ""
