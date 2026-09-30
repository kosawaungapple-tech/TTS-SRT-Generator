import React, { useState, useEffect } from 'react';
import { Info, AlertTriangle, CheckCircle, PartyPopper, X } from 'lucide-react';
import { Announcement } from '../types';

interface AnnouncementPanelProps {
  announcements: Announcement[] | undefined;
}

export const AnnouncementPanel: React.FC<AnnouncementPanelProps> = ({ announcements }) => {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('dismissed_announcements');
    if (stored) {
      try {
        setDismissedIds(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse dismissed announcements", e);
      }
    }
  }, []);

  const handleDismiss = (id: string) => {
    const updated = [...dismissedIds, id];
    setDismissedIds(updated);
    localStorage.setItem('dismissed_announcements', JSON.stringify(updated));
  };

  if (!announcements || announcements.length === 0) return null;

  const activeAnnouncements = announcements
    .filter(a => {
      if (!a.isActive) return false;
      if (dismissedIds.includes(a.id)) return false;
      
      const now = new Date();
      if (a.startDate && new Date(a.startDate) > now) return false;
      if (a.endDate && new Date(a.endDate) < now) return false;
      
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (activeAnnouncements.length === 0) return null;

  // For the marquee, we combine all messages
  const combinedMessage = activeAnnouncements.map(a => {
    const icon = a.type === 'promotion' ? '🎉' : a.type === 'warning' ? '⚠️' : a.type === 'success' ? '✅' : 'ℹ️';
    return `${icon} ${a.message}`;
  }).join('   ◆   ');

  // We use the first announcement's type and dismissible status for the banner style
  // or a default if multiple different types exist. 
  // Let's pick the "highest" priority type: promotion > warning > success > info
  const priorityMap = { promotion: 4, warning: 3, success: 2, info: 1 };
  const topAnnouncement = activeAnnouncements.reduce((prev, curr) => 
    priorityMap[curr.type] > priorityMap[prev.type] ? curr : prev
  );

  const typeConfig = {
    info: {
      bg: 'bg-blue-600',
      label: 'သတင်း',
      icon: <Info size={16} />,
      gradient: ''
    },
    warning: {
      bg: 'bg-amber-500',
      label: 'သတိပေးချက်',
      icon: <AlertTriangle size={16} />,
      gradient: ''
    },
    success: {
      bg: 'bg-emerald-500',
      label: 'ကောင်းသတင်း',
      icon: <CheckCircle size={16} />,
      gradient: ''
    },
    promotion: {
      bg: 'bg-brand-purple',
      label: 'အသစ်',
      icon: <PartyPopper size={16} />,
      gradient: 'linear-gradient(90deg, #6B21A8, #9333EA, #6B21A8)'
    }
  };

  const config = typeConfig[topAnnouncement.type];
  const scrollSpeed = topAnnouncement.scrollSpeed || 'normal';
  const duration = scrollSpeed === 'fast' ? '8s' : scrollSpeed === 'slow' ? '25s' : '15s';

  const isPromotion = topAnnouncement.type === 'promotion';

  return (
    <div 
      className={`sticky top-[64px] z-50 w-full h-[36px] flex items-center overflow-hidden border-b border-white/10 ${isPromotion ? '' : config.bg}`}
      style={isPromotion ? { 
        background: config.gradient,
        backgroundSize: '200% 100%',
        animation: 'gradientShift 3s ease infinite'
      } : {}}
    >
      {/* Left side: Badge */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 h-full bg-black/20 backdrop-blur-sm z-10 border-r border-white/10">
        <span className="text-white">
          {config.icon}
        </span>
        <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider backdrop-blur-md">
          {config.label}
        </span>
      </div>

      {/* Middle: Marquee */}
      <div className="marquee-container flex-grow h-full flex items-center relative">
        <div 
          className="marquee-text text-white text-xs font-medium px-4"
          style={{ animationDuration: duration }}
        >
          {combinedMessage}
          {/* Repeating for seamless wrap if it's short, but usually one combined line is enough */}
          <span className="mx-20" />
          {combinedMessage}
        </div>
      </div>

      {/* Right side: Close */}
      {topAnnouncement.dismissible && (
        <div className="flex-shrink-0 h-full flex items-center px-4 bg-black/10 backdrop-blur-sm z-10 border-l border-white/10">
          <button 
            onClick={() => handleDismiss(topAnnouncement.id)}
            className="text-white/70 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
