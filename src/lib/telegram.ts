const LIMIT = 4000;

/** Telegram caps a message at 4096 characters; longer text is cut with a marker. */
export function fitTelegram(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= LIMIT ? trimmed : `${trimmed.slice(0, LIMIT - 20).trimEnd()}\n\n… (kısaltıldı)`;
}

export type Notifier = (text: string) => Promise<void>;

/** Sends plain text (no Markdown parsing, so agent output cannot break formatting). */
export function createTelegramNotifier(botToken?: string, chatId?: string): Notifier {
  if (!botToken || !chatId) return async () => undefined;
  return async (text) => {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: fitTelegram(text), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
  };
}
