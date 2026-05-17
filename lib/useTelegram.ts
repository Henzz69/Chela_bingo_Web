'use client';

import { useEffect, useState } from 'react';

export function useTelegram() {
  const [tgId, setTgId] = useState<number | null>(null);
  const [isTelegram, setIsTelegram] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Safe haptics object that won't crash if used in a normal web browser
  const [haptic] = useState({
    impact: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => {
      if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.HapticFeedback) {
        (window as any).Telegram.WebApp.HapticFeedback.impactOccurred(style);
      }
    },
    notification: (type: 'error' | 'success' | 'warning') => {
      if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.HapticFeedback) {
        (window as any).Telegram.WebApp.HapticFeedback.notificationOccurred(type);
      }
    },
    selection: () => {
      if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.HapticFeedback) {
        (window as any).Telegram.WebApp.HapticFeedback.selectionChanged();
      }
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initTg = () => {
      const telegram = (window as any).Telegram;
      const webApp = telegram?.WebApp;

      // Ensure WebApp exists AND has the secure initData string
      if (webApp && webApp.initData) {
        setIsTelegram(true);
        webApp.ready();
        webApp.expand();

        // 🚀 THE SECURITY FIX: Send the raw signature to our secure backend
        fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: webApp.initData })
        })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.verifiedTgId) {
            // The backend mathematically confirmed this user!
            setTgId(data.verifiedTgId);
            setIsVerified(true);
          } else {
            console.error("Telegram Auth Failed:", data.error);
            setAuthError("Failed to verify Telegram identity.");
          }
        })
        .catch(err => {
          console.error("Telegram Auth Network Error:", err);
          setAuthError("Network error during verification.");
        });

        return true; 
      }
      return false; 
    };

    // Try immediately
    if (!initTg()) {
      // If Telegram script hasn't loaded yet, try again in 100ms
      setTimeout(() => {
        if (!initTg()) {
          // ⚠️ LOCAL DEV FALLBACK ⚠️
          // If the app is opened in a normal Chrome browser (not Telegram), 
          // default to your Admin ID so you can still test the UI locally.
          console.warn("Running outside Telegram. Using mock ID for development.");
          setTgId(5681654051); 
          setIsVerified(true);
        }
      }, 100);
    }
  }, []);

  return { tgId, isTelegram, isVerified, authError, haptic };
}