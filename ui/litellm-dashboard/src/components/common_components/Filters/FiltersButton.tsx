import { Badge, Button } from "antd";
import { Filter } from "lucide-react";
import React from "react";
import { getTranslation } from "@/i18n";

interface FiltersButtonProps {
  onClick: () => void;
  active: boolean;
  hasActiveFilters: boolean;
  label?: string;
}

export const FiltersButton: React.FC<FiltersButtonProps> = ({
  onClick,
  active,
  hasActiveFilters,
  label = getTranslation("common.filter"),
}) => {
  return (
    <Badge color="blue" dot={hasActiveFilters}>
      <Button type="default" onClick={onClick} icon={<Filter size={16} />} className={active ? "bg-gray-100" : ""}>
        {label}
      </Button>
    </Badge>
  );
};
