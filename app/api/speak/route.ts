import { NextResponse } from 'next/server';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Good storytelling voices from ElevenLabs
// Rachel: calm, clear female voice - great for narration
// Adam: deep male voice
// Antoni: warm male voice
const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Rachel - good for storytelling

export async function POST(request: Request) {
  try {
    console.log('[SPEAK] API called, key configured:', !!ELEVENLABS_API_KEY);

    if (!ELEVENLABS_API_KEY) {
      console.error('[SPEAK] No ELEVENLABS_API_KEY set');
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured' },
        { status: 500 }
      );
    }

    const { text } = await request.json();

    if (!text) {
      return NextResponse.json(
        { error: 'No text provided' },
        { status: 400 }
      );
    }

    // Limit text length to avoid huge API costs
    const trimmedText = text.slice(0, 5000);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: trimmedText,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.6,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SPEAK] ElevenLabs error:', response.status, errorText);
      return NextResponse.json(
        { error: `ElevenLabs error: ${response.status}` },
        { status: 500 }
      );
    }

    console.log('[SPEAK] ElevenLabs success, returning audio');

    // Return the audio stream
    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      },
    });
  } catch (error) {
    console.error('Speech API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate speech' },
      { status: 500 }
    );
  }
}
