import { Config } from '../types';

export const sendTelegramNotification = async (message: string, config: Config) => {
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
  } catch (error: any) {
    console.error('Telegram Notification Error:', error);
    throw error;
  }
};
