export interface TelegramConfig {
  telegramBotToken?: string;
  telegramChatId?: string;
  [key: string]: unknown;
}

export type Config = TelegramConfig;

export const sendTelegramNotification = async (message: string, config: TelegramConfig) => {
  try {
    const response = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        config
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }
  } catch (error: unknown) {
    console.error('Telegram Notification Error:', error);
    throw error;
  }
};
