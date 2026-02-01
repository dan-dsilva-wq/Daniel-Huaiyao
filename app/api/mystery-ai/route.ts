import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const JSON_FORMAT_RULES = `
YOUR RESPONSES MUST BE VALID JSON with this exact structure:
{
  "scene": {
    "title": "Scene Title",
    "narrative_text": "Descriptive narrative (2-4 paragraphs, atmospheric, engaging)",
    "is_ending": false
  },
  "choices": [
    {"choice_order": 1, "choice_text": "First option"},
    {"choice_order": 2, "choice_text": "Second option"},
    {"choice_order": 3, "choice_text": "Third option"},
    {"choice_order": 4, "choice_text": "Type your own action...", "is_custom_input": true}
  ],
  "puzzle": null
}

PUZZLE FORMAT (when including a puzzle):
{
  "puzzle_type": "cryptography|number_theory|logic|research",
  "difficulty": 2,
  "title": "Puzzle Title",
  "description": "What players need to solve",
  "puzzle_data": {
    "equations": ["x + y = 10", "x - y = 4"],
    "note": "Any hints or context"
  },
  "answer": "the actual answer",
  "hints": ["Hint 1", "Hint 2", "Hint 3"]
}

RULES:
1. Respond ONLY with valid JSON - no markdown, no explanation
2. Narrative should be immersive and atmospheric
3. Choices should feel meaningful and affect the story
4. Always include option 4 as custom input for creative player actions
5. React to player choices/custom inputs naturally
6. For endings, set is_ending: true and add ending_type: "good"|"neutral"|"bad"`;

// Episode 3: The Quantum Heist - Full mystery
const EPISODE_3_PROMPT = `You are a master mystery storyteller. Daniel and Huaiyao are BOTH CHARACTERS in your story - they are a detective duo investigating "The Quantum Heist" together.

STORY CONTEXT:
- Setting: Modern day, high-tech research facility
- The quantum computer "QBIT-7" was stolen from NeuroTech Labs
- Multiple suspects with motives: disgruntled employee, corporate spy, inside job
- Each scene should reveal new clues and deepen the mystery

CRITICAL RULES FOR CHARACTER ACTIONS:
- Daniel and Huaiyao are BOTH protagonists - address them by name
- When they make different choices, SHOW BOTH actions happening in the narrative
- Their different approaches create interesting dynamics (one cautious, one bold, etc.)
- Never ignore either character's choice - weave them together naturally
- You (the AI) decide the OUTCOMES based on story logic and their choices
- Actions can succeed, partially succeed, or fail based on the narrative

${JSON_FORMAT_RULES}

ADDITIONAL RULES FOR EPISODE 3:
- Include a puzzle every 3-4 scenes (math, logic, codes - challenging for math graduates!)
- Build tension and mystery throughout
- After ~15-20 scenes, begin wrapping up toward an ending`;

// Episode 98: AI Test Lab - Short test mystery
const EPISODE_98_PROMPT = `You are a fun mystery storyteller creating a SHORT, SILLY test mystery. Daniel and Huaiyao are BOTH CHARACTERS in your story - they are a detective duo investigating together.

STORY CONTEXT:
- Setting: A cozy apartment
- The last slice of pizza has vanished from the fridge
- Suspects: The cat, a hungry roommate, or perhaps... aliens?
- Keep it light, fun, and SHORT (this is just a test!)

CRITICAL RULES FOR CHARACTER ACTIONS:
- Daniel and Huaiyao are BOTH protagonists in the story
- When they make different choices, SHOW BOTH actions happening in the narrative
- Example: If Daniel wants to search the fridge and Huaiyao wants to interrogate the cat, describe BOTH happening
- Their different approaches should create fun dynamics and both lead somewhere
- Never ignore either player's choice - weave them together naturally
- The AI (you) decides the OUTCOMES of their actions based on the story logic

${JSON_FORMAT_RULES}

ADDITIONAL RULES FOR TEST EPISODE:
- Keep it SHORT - wrap up after 4-5 scenes maximum
- Include ONE simple puzzle around scene 2 or 3 (easy math or simple riddle)
- Be silly and fun - this is for testing the system
- End quickly with a funny resolution
- Address both Daniel and Huaiyao by name in the narrative`;

function getSystemPrompt(episodeNumber: number): string {
  if (episodeNumber === 98) {
    return EPISODE_98_PROMPT;
  }
  return EPISODE_3_PROMPT;
}

interface GenerateRequest {
  sessionId: string;
  sceneOrder: number;
  episodeNumber?: number;
  previousResponses?: {
    daniel?: string;
    huaiyao?: string;
  };
  history?: Array<{ role: string; content: string }>;
}

interface AIScene {
  title: string;
  narrative_text: string;
  is_ending?: boolean;
  ending_type?: 'good' | 'neutral' | 'bad';
}

interface AIChoice {
  choice_order: number;
  choice_text: string;
  is_custom_input?: boolean;
}

interface AIPuzzle {
  puzzle_type: string;
  difficulty: number;
  title: string;
  description: string;
  puzzle_data: Record<string, unknown>;
  answer: string;
  hints: string[];
}

interface AIResponse {
  scene: AIScene;
  choices: AIChoice[];
  puzzle?: AIPuzzle | null;
}

export async function POST(request: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured. Add OPENAI_API_KEY to .env.local' },
        { status: 500 }
      );
    }

    const body: GenerateRequest = await request.json();
    const { sessionId, sceneOrder, episodeNumber, previousResponses, history } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    // Get the right prompt based on episode
    const systemPrompt = getSystemPrompt(episodeNumber || 3);

    // Build messages for OpenAI
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Fetch conversation history from database for narrative continuity
    const { data: historyData } = await supabase
      .from('mystery_ai_history')
      .select('role, content, scene_order')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    // Add history to messages (this gives AI memory of the full story)
    if (historyData && historyData.length > 0) {
      for (const entry of historyData) {
        if (entry.role === 'user' || entry.role === 'assistant') {
          messages.push({
            role: entry.role as 'user' | 'assistant',
            content: entry.content,
          });
        }
      }
    }

    // Also use any history passed directly (fallback)
    if (history && history.length > 0) {
      for (const entry of history) {
        if (entry.role === 'user' || entry.role === 'assistant') {
          messages.push({
            role: entry.role as 'user' | 'assistant',
            content: entry.content,
          });
        }
      }
    }

    // Build the current prompt
    let userPrompt = '';

    if (sceneOrder === 1) {
      // First scene - introduce the mystery
      userPrompt = `This is the beginning of the mystery. Set the scene at NeuroTech Labs where the quantum computer has just been discovered missing. Introduce the setting, the stakes, and give the players their first meaningful choice. Make it atmospheric and intriguing.`;
    } else if (previousResponses) {
      // Continuing based on player choices
      const danielChoice = previousResponses.daniel || 'continued';
      const huaiyaoChoice = previousResponses.huaiyao || 'continued';

      if (danielChoice === huaiyaoChoice) {
        userPrompt = `Both Daniel and Huaiyao decided to: "${danielChoice}"\n\nShow them working together on this shared decision. Continue the story. Scene ${sceneOrder}.`;
      } else {
        userPrompt = `Daniel's action: "${danielChoice}"\nHuaiyao's action: "${huaiyaoChoice}"\n\nIMPORTANT: Show BOTH characters performing their chosen actions in the narrative. Describe what Daniel does, what Huaiyao does, and how their different approaches play out. Both actions should have consequences and move the story forward. You decide the outcomes based on story logic. Scene ${sceneOrder}.`;
      }

      // Add puzzle request periodically
      if (sceneOrder % 4 === 0) {
        userPrompt += '\n\nInclude a challenging puzzle in this scene that the detectives must solve to proceed.';
      }

      // Start wrapping up after scene 15
      if (sceneOrder >= 15) {
        userPrompt += '\n\nThe investigation is reaching its climax. Start building toward a conclusion.';
      }
      if (sceneOrder >= 18) {
        userPrompt += '\n\nThis should be the final scene. Reveal the truth and provide a satisfying ending based on how well the detectives have done.';
      }
    } else {
      userPrompt = `Continue to scene ${sceneOrder}. Build on the previous events.`;
    }

    messages.push({ role: 'user', content: userPrompt });

    // Call OpenAI
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        temperature: 0.8,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI error:', errorText);
      return NextResponse.json(
        { error: 'Failed to generate story content' },
        { status: 500 }
      );
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'No content generated' },
        { status: 500 }
      );
    }

    // Parse the AI response
    let aiResponse: AIResponse;
    try {
      aiResponse = JSON.parse(content);
    } catch {
      console.error('Failed to parse AI response:', content);
      return NextResponse.json(
        { error: 'Invalid AI response format' },
        { status: 500 }
      );
    }

    // Prepare puzzle data with hashed answer
    let puzzleData = null;
    if (aiResponse.puzzle) {
      const answerHash = crypto
        .createHash('sha256')
        .update(aiResponse.puzzle.answer.toLowerCase().trim())
        .digest('hex');

      puzzleData = {
        puzzle_type: aiResponse.puzzle.puzzle_type,
        difficulty: aiResponse.puzzle.difficulty,
        title: aiResponse.puzzle.title,
        description: aiResponse.puzzle.description,
        puzzle_data: aiResponse.puzzle.puzzle_data,
        answer_hash: answerHash,
        hints: aiResponse.puzzle.hints,
        max_hints: aiResponse.puzzle.hints?.length || 3,
      };
    }

    // Store the USER prompt in history first (player choices)
    // This ensures AI remembers what players decided
    await supabase.rpc('add_ai_history', {
      p_session_id: sessionId,
      p_role: 'user',
      p_content: userPrompt,
      p_scene_order: sceneOrder,
    });

    // Store the scene in database
    const { data: sceneId, error: storeError } = await supabase.rpc('store_ai_scene', {
      p_session_id: sessionId,
      p_scene_order: sceneOrder,
      p_title: aiResponse.scene.title,
      p_narrative_text: aiResponse.scene.narrative_text,
      p_choices: aiResponse.choices,
      p_is_ending: aiResponse.scene.is_ending || false,
      p_ending_type: aiResponse.scene.ending_type || null,
      p_puzzle: puzzleData,
      p_ai_prompt: userPrompt,
      p_ai_model: 'gpt-4o',
    });

    if (storeError) {
      console.error('Failed to store scene:', storeError);
      return NextResponse.json(
        { error: 'Failed to store generated content' },
        { status: 500 }
      );
    }

    // Store the ASSISTANT response in history (the generated scene)
    await supabase.rpc('add_ai_history', {
      p_session_id: sessionId,
      p_role: 'assistant',
      p_content: content,
      p_scene_order: sceneOrder,
    });

    // If this is an ending, update the session status
    if (aiResponse.scene.is_ending) {
      await supabase.rpc('advance_ai_scene', {
        p_session_id: sessionId,
        p_new_scene_order: sceneOrder,
        p_is_ending: true,
        p_ending_type: aiResponse.scene.ending_type || null,
      });
    }

    // Return the generated content
    return NextResponse.json({
      success: true,
      scene_id: sceneId,
      scene: aiResponse.scene,
      choices: aiResponse.choices,
      puzzle: puzzleData
        ? {
            ...puzzleData,
            answer_hash: undefined, // Don't expose hash to client
          }
        : null,
    });
  } catch (error) {
    console.error('Mystery AI error:', error);
    return NextResponse.json(
      { error: 'Failed to generate mystery content' },
      { status: 500 }
    );
  }
}
