import React from 'react';
import { StoryAudiobookStudio } from './StoryAudiobookStudio';
import { VBSUserControl, ModalConfig, CustomFont } from '../types';

interface ThumbnailTabProps {
  showToast: (message: string, type: 'success' | 'error') => void;
  openModal: (config: ModalConfig) => void;
  getApiKey: () => string | null;
  isAdmin: boolean;
  isPremium: boolean;
  userControl?: VBSUserControl | null;
  onNavigateToSettings?: () => void;
  onProcessingStateChange?: (isProcessing: boolean) => void;
  customFonts?: CustomFont[];
}

export const ThumbnailCreator: React.FC<ThumbnailTabProps> = (props) => {
  return <StoryAudiobookStudio {...props} />;
};

export { StoryAudiobookStudio };
