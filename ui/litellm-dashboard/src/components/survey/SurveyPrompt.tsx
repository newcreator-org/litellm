import React from "react";
import { useTranslation } from "@/i18n";
import { MessageSquare } from "lucide-react";
import { NudgePrompt } from "./NudgePrompt";

interface SurveyPromptProps {
  onOpen: () => void;
  onDismiss: () => void;
  isVisible: boolean;
}

export function SurveyPrompt({ onOpen, onDismiss, isVisible }: SurveyPromptProps) {
  const { t } = useTranslation();
  return (
    <NudgePrompt
      onOpen={onOpen}
      onDismiss={onDismiss}
      isVisible={isVisible}
      title={t("survey.title")}
      description={t("survey.description")}
      buttonText={t("survey.shareFeedback")}
      icon={MessageSquare}
      accentColor="#3b82f6"
    />
  );
}

