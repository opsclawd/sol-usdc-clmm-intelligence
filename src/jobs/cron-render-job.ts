import {
  renderCronCommands,
  type RenderCronCommandsDeps
} from "../application/render-cron-commands.js";

export function cronRenderJob(deps: RenderCronCommandsDeps): () => Promise<string[]> {
  return () => renderCronCommands(deps);
}
