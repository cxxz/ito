import { InteractionsRepository } from '../../db/repo.js'
import type { Interaction } from '../../db/models.js'

export interface CreateInteractionParams {
  id: string
  userId: string
  title: string
  asrOutput: string
  llmOutput: string | null
  durationMs: number
}

/**
 * Creates an interaction in the database.
 * This helper is shared between the gRPC createInteraction endpoint and
 * the transcribeStreamV2Handler.
 */
export async function createInteractionWithAudio(
  params: CreateInteractionParams,
): Promise<Interaction> {
  const { id, userId, title, asrOutput, llmOutput, durationMs } = params

  // Create interaction in database
  const interaction = await InteractionsRepository.create({
    id,
    userId,
    title,
    asrOutput,
    llmOutput,
    durationMs,
  })

  console.log(`✅ [${new Date().toISOString()}] Created interaction: ${id}`)

  return interaction
}
