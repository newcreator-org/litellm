import { Button } from "antd";
import { RotateCcw } from "lucide-react";
import React from "react";
import { getTranslation } from "@/i18n";

interface ResetFiltersButtonProps {
  onClick: () => void;
  label?: string;
}

export const ResetFiltersButton: React.FC<ResetFiltersButtonProps> = ({ onClick, label = getTranslation("common.resetFilters") }) => {
  return (
    <Button type="default" onClick={onClick} icon={<RotateCcw size={16} />}>
      {label}
    </Button>
  );
};
