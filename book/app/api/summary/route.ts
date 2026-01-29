import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { sentences } = await request.json();

    if (!sentences || sentences.length === 0) {
      return NextResponse.json({ summary: null });
    }

    // Format the story so far
    const storyText = sentences
      .map((s: { writer: string; content: string }) => `${s.writer === 'daniel' ? 'Daniel' : 'Huaiyao'}: "${s.content}"`)
      .join('\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a dramatic narrator for a collaborative story called "Death on a Desert Island" written by a couple named Daniel and Huaiyao.

Your job is to write a very brief, dramatic "Previously on..." style recap.

Rules:
- Maximum 1-2 sentences only
- Be dramatic and cinematic
- Use present tense
- End with a hook or cliffhanger
- No quotation marks
- Make it punchy and exciting`
          },
          {
            role: 'user',
            content: `Here is the story so far. Write a dramatic "Previously on Death on a Desert Island..." recap:\n\n${storyText}`
          }
        ],
        max_tokens: 100,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      console.error('OpenAI API error:', await response.text());
      return NextResponse.json({ summary: null });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content || null;

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('Summary generation error:', error);
    return NextResponse.json({ summary: null });
  }
}
