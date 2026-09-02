/**
 * The starting prompt a player pastes into the chat beside the page.
 *
 * The page cannot type into ChatGPT — WebMCP has no such channel — so the lobby
 * offers the text and a copy button, and the player pastes it.
 *
 * It is deliberately short. How the agent should behave is already in the tool
 * descriptions: `present_guidance` carries the whole coach-first protocol and
 * `get_incident.coaching.consent` says when a move needs the player. A
 * description reaches every agent that ever connects; a prompt reaches one. So
 * this sets only what a description cannot know — who the player is, which
 * language to speak, and how much explanation they want — and starts the loop.
 *
 * No persona. `present_guidance` tells the model it has no character of its
 * own, and a prompt that handed it one would be arguing with the tool it is
 * about to call.
 */
export type PromptMode = 'learn' | 'solve';
export type PromptLanguage = 'tr' | 'en';

export const AGENT_PROMPTS: Record<PromptMode, Record<PromptLanguage, string>> = {
  learn: {
    tr:
      'Bu sayfadaki CYCASE site araçlarını kullan. Ben gece vardiyasındaki olay komutanıyım ve ' +
      'olay müdahalesinde yeniyim. get_incident ile başla ve page alanına bak: konsolu henüz ' +
      'açmadıysam bana ne yapmam gerektiğini söyle. Her adımda ne gördüğünü, neden önemli ' +
      'olduğunu ve seçeneklerimi Türkçe, 2–4 kısa cümleyle anlat. Sonuç doğuran her hamleyi ' +
      'uygulama, öner ve bekle; kararı ben veririm. Ben onayladıktan sonra gerçekte ne olduğunu ' +
      'söyle. Vakayı güvenli biçimde kapatana kadar yanımda kal.',
    en:
      'Use the CYCASE site tools on this page. I am the incident commander on the night shift ' +
      'and I am new to incident response. Start with get_incident and read its page field: if I ' +
      'have not opened the console yet, tell me what to do. At each step, say what you see, why ' +
      'it matters and what my options are, in two to four short sentences. Never apply a ' +
      'consequential move — propose it and wait; I decide. Once I have approved, tell me what ' +
      'actually happened. Stay with me until the case is closed safely.',
  },
  solve: {
    tr:
      'Bu sayfadaki CYCASE site araçlarıyla vakayı çöz. Ben gece vardiyasındaki olay ' +
      'komutanıyım. get_incident ile başla ve page alanına bak. Okuma ve teşhisleri en iyi ' +
      'sırada kendin yürüt, her anlamlı adımda Türkçe tek kısa satırla ne bulduğunu söyle. ' +
      'Sonuç doğuran hamleleri uygulama: etkisini bir cümleyle söyleyip öner ve onayımı bekle. ' +
      'Kritik bulgu bırakmadan kapat ve sonucu sayfadaki debrief ile karşılaştır.',
    en:
      'Solve the case with the CYCASE site tools on this page. I am the incident commander on ' +
      'the night shift. Start with get_incident and read its page field. Run the reads and ' +
      'diagnostics yourself in the best order, and say what you found in one short line per ' +
      'meaningful step. Do not apply consequential moves: state the impact in a sentence, ' +
      'propose, and wait for my approval. Close with no critical finding open, then compare the ' +
      'result with the debrief on the page.',
  },
};

export function agentPrompt(mode: PromptMode, language: PromptLanguage): string {
  return AGENT_PROMPTS[mode][language];
}
