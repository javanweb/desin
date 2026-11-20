import React from 'react';
import { User, ChevronLeft, Copy, Check, ThumbsUp, ThumbsDown } from 'lucide-react';
import { renderEngineeringMarkdown } from '../../utils/engineeringMarkdown';
import { CognivoGeometricLogo } from '../common/AiFloatingButton';

export interface WorkspaceMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  time: string;
  suggestedAction?: {
    label: string;
    link?: string;
  };
}

interface WorkspaceMessageItemProps {
  message: WorkspaceMessage;
  isCopied: boolean;
  feedback?: 'up' | 'down';
  onCopy: (text: string, id: string) => void;
  onFeedback: (id: string, vote: 'up' | 'down') => void;
  onNavigateLink: (link: string) => void;
}

export const WorkspaceMessageItem: React.FC<WorkspaceMessageItemProps> = React.memo(
  ({ message, isCopied, feedback, onCopy, onFeedback, onNavigateLink }) => {
    const isUser = message.sender === 'user';

    return (
      <div
        className={`flex items-start gap-2.5 sm:gap-3.5 ${
          isUser ? 'flex-row-reverse' : ''
        }`}
      >
        {/* Desktop Side Avatar */}
        <div
          className={`hidden sm:flex w-8 h-8 rounded-xl items-center justify-center shrink-0 shadow-2xs ${
            isUser
              ? 'bg-[#2B313A] text-white'
              : 'bg-[#FFFFFF] border border-[#DCE1E7] text-[#E06518]'
          }`}
        >
          {isUser ? (
            <User className="w-4 h-4" />
          ) : (
            <CognivoGeometricLogo className="w-4.5 h-4.5" />
          )}
        </div>

        {/* Message Surface */}
        <div
          className={`rounded-2xl sm:rounded-3xl p-3.5 sm:p-4.5 space-y-2.5 transition-colors ${
            isUser
              ? 'max-w-[88%] sm:max-w-[78%] bg-[#2B313A] text-white rounded-tr-xs shadow-2xs'
              : 'w-full sm:flex-1 sm:max-w-[84%] bg-[#FFFFFF] text-[#2B313A] border border-[#DCE1E7] rounded-tl-xs shadow-2xs'
          }`}
        >
          {/* Message Header */}
          <div className="flex items-center justify-between text-[11px] pb-1.5 border-b border-current/10">
            <div className="flex items-center gap-1.5">
              {!isUser && (
                <span className="sm:hidden inline-flex items-center justify-center w-5 h-5 rounded-md bg-[#FFF4EC] border border-[#F8D3B8]">
                  <CognivoGeometricLogo className="w-3.5 h-3.5" />
                </span>
              )}
              <span className="font-bold">
                {isUser ? 'شما' : 'مشاور مهندسی FORZA'}
              </span>
            </div>
            <span className="opacity-65 tabular-nums font-mono text-[10px]">
              {message.time}
            </span>
          </div>

          {/* Message Body */}
          <div className="text-[13px] sm:text-sm leading-relaxed font-normal break-words">
            {!isUser ? (
              renderEngineeringMarkdown(message.text, false)
            ) : (
              <div className="whitespace-pre-wrap">{message.text}</div>
            )}
          </div>

          {/* Suggested Catalog Navigation CTA */}
          {message.suggestedAction && message.suggestedAction.link && (
            <div className="pt-1.5">
              <button
                type="button"
                onClick={() => onNavigateLink(message.suggestedAction!.link!)}
                className="w-full min-h-[42px] py-2 px-3.5 rounded-xl bg-[#F6F7F9] hover:bg-[#E06518] hover:text-white text-[#2B313A] font-bold text-xs flex items-center justify-between border border-[#DCE1E7] hover:border-[#E06518] transition-colors cursor-pointer"
              >
                <span>{message.suggestedAction.label}</span>
                <ChevronLeft className="w-4 h-4 shrink-0" />
              </button>
            </div>
          )}

          {/* AI Message Action Footer */}
          {!isUser && message.text.trim().length > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-[#E6E9EE] text-xs">
              <span className="text-[10px] text-[#777A7D] font-medium">
                مرجع فنی کاتالوگ اطلس
              </span>

              <div className="flex items-center gap-1 text-[#55565A]">
                <button
                  type="button"
                  onClick={() => onCopy(message.text, message.id)}
                  className="min-h-[34px] px-2 hover:text-[#2B313A] hover:bg-[#F3F4F6] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  title="کپی متن"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700 font-bold text-[10px]">کپی شد</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline text-[10px] font-semibold">کپی</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onFeedback(message.id, 'up')}
                  aria-label="پاسخ مفید بود"
                  className={`min-w-[34px] min-h-[34px] rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                    feedback === 'up'
                      ? 'text-emerald-600 bg-emerald-50'
                      : 'hover:text-[#2B313A] hover:bg-[#F3F4F6]'
                  }`}
                  title="مفید بود"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onFeedback(message.id, 'down')}
                  aria-label="پاسخ نیاز به بازنگری دارد"
                  className={`min-w-[34px] min-h-[34px] rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                    feedback === 'down'
                      ? 'text-rose-600 bg-rose-50'
                      : 'hover:text-[#2B313A] hover:bg-[#F3F4F6]'
                  }`}
                  title="نیاز به بازنگری"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
);

WorkspaceMessageItem.displayName = 'WorkspaceMessageItem';
