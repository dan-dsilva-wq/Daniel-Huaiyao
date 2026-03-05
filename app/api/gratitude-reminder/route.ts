import { NextResponse } from 'next/server';
import { sendPushToUsers, type KnownUser } from '@/lib/server/push';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';

// This endpoint is called by a cron job at 8 PM Eastern
export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Check who wrote gratitude today
    const today = new Date().toISOString().split('T')[0];

    const { data: todayNotes, error: notesError } = await supabase
      .from('gratitude_notes')
      .select('from_player')
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59`);

    if (notesError) {
      console.error('Error checking gratitude notes:', notesError);
      return NextResponse.json({ error: 'Failed to check notes' }, { status: 500 });
    }

    // Who has already written today?
    const wroteToday = new Set(todayNotes?.map(n => n.from_player) || []);
    const needsReminder: KnownUser[] = [];

    if (!wroteToday.has('daniel')) needsReminder.push('daniel');
    if (!wroteToday.has('huaiyao')) needsReminder.push('huaiyao');

    if (needsReminder.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Both have written gratitude today'
      });
    }

    let sent = 0;
    let failed = 0;
    const failures: string[] = [];
    for (const user of needsReminder) {
      const partnerName = user === 'daniel' ? 'Huaiyao' : 'Daniel';
      const result = await sendPushToUsers([user], {
        title: 'Gratitude Wall',
        body: `Take a moment to share gratitude with ${partnerName} 💝`,
        icon: '/icons/icon-192.png',
        url: '/gratitude',
        tag: 'gratitude-reminder',
      });
      sent += result.sent;
      failed += result.failed;
      if (!result.success && result.reason) {
        failures.push(`${user}: ${result.reason}`);
      }
    }

    if (failures.length > 0) {
      return NextResponse.json(
        {
          error: 'Failed to send reminders for some users',
          details: failures.join('; '),
          sent,
          failed,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
      remindedUsers: needsReminder
    });
  } catch (error) {
    console.error('Gratitude reminder error:', error);
    return NextResponse.json({ error: 'Failed to send reminder' }, { status: 500 });
  }
}
