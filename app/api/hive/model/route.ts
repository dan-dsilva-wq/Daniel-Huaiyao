import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { parseHiveModel } from '@/lib/hive/ml';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  const modelPath = path.resolve(process.cwd(), 'lib/hive/trained-model.json');

  try {
    const raw = readFileSync(modelPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const model = parseHiveModel(parsed);

    if (!model) {
      return NextResponse.json(
        {
          error: 'Invalid Hive model file',
          modelPath,
        },
        { status: 500 },
      );
    }

    const stats = statSync(modelPath);
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12);

    return NextResponse.json({
      model,
      hash,
      modelPath,
      generatedAt: model.training.generatedAt,
      fileLastModifiedAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: message,
        modelPath,
      },
      { status: 500 },
    );
  }
}
