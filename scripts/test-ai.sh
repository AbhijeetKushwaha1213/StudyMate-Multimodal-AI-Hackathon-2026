#!/bin/bash

echo "🧪 Testing AI Assistant Connection"
echo "===================================="
echo ""

# Get the anon key from .env
ANON_KEY=$(grep ANON_KEY .env | cut -d '=' -f2 | tr -d '"')

if [ -z "$ANON_KEY" ]; then
    echo "❌ Error: Could not find ANON_KEY in .env file"
    exit 1
fi

echo "Testing connection to Supabase edge function..."
echo ""

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" --location --request POST \
  'https://cmcbkatdyhunlvlktwlv.supabase.co/functions/v1/ai-assistant' \
  --header "Authorization: Bearer $ANON_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"message":"Hello"}')

HTTP_STATUS=$(echo "$RESPONSE" | grep HTTP_STATUS | cut -d ':' -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ Success! AI assistant is working"
elif [ "$HTTP_STATUS" = "500" ]; then
    echo "❌ Error: Function returned 500"
    echo ""
    echo "Common causes:"
    echo "1. Gemini API key not set - run: ./scripts/deploy-gemini.sh YOUR_KEY"
    echo "2. Function not deployed - run: supabase functions deploy ai-assistant"
    echo "3. Invalid API key - check your Gemini API key"
else
    echo "❌ Error: Unexpected status code $HTTP_STATUS"
fi

echo ""
