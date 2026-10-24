"use client";

import React, { useState, useMemo, useEffect } from "react";
import Modal from "./ui/Modal";
import { parseSearchQuery, matchesSearch } from "@/lib/modelSearchFilter";

export interface PickerModel {
  id: string;
  name: string;
  value: string;
}

interface PickerCombo {
  id: string;
  name: string;
}

interface ModelPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (model: PickerModel) => void;
  onDeselect?: (model: PickerModel) => void;
  onSelectBatch?: (models: PickerModel[]) => void;
  onDeselectBatch?: (models: PickerModel[]) => void;
  selectedModel?: string;
  title?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  addedModelValues?: string[];
  closeOnSelect?: boolean;
}

/**
 * Muse-adapted port of 9router's ModelSelectModal.
 * Data sources: /api/combos (combo chips) + /v1/models (model chips).
 */
export default function ModelPickerModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  onSelectBatch,
  onDeselectBatch,
  selectedModel,
  title = "Select Model",
  size = "lg",
  addedModelValues = [],
  closeOnSelect = true,
}: ModelPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState<PickerCombo[]>([]);
  const [models, setModels] = useState<PickerModel[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await fetch("/api/combos");
        if (res.ok) {
          const data = await res.json();
          setCombos(Array.isArray(data.combos) ? data.combos : []);
        }
      } catch { /* combos stay empty */ }
      try {
        const res = await fetch("/v1/models");
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data.data) ? data.data : [];
          setModels(
            list
              .filter((m: { id?: unknown }) => typeof m?.id === "string")
              .map((m: { id: string }) => ({ id: m.id, name: m.id, value: m.id }))
          );
        }
      } catch { /* models stay empty */ }
    })();
  }, [isOpen]);

  const parsedQuery = useMemo(() => parseSearchQuery(searchQuery), [searchQuery]);

  // Combo names double as model ids in /v1/models — keep them out of the models list
  const comboNames = useMemo(() => new Set(combos.map((c) => c.name)), [combos]);
  const pureModels = useMemo(() => models.filter((m) => !comboNames.has(m.value)), [models, comboNames]);

  const filteredCombos = useMemo(() => {
    if (parsedQuery.isEmpty) return combos;
    return combos.filter((c) => matchesSearch(c.name, parsedQuery));
  }, [combos, parsedQuery]);

  const sortModels = (list: PickerModel[]) => {
    const added = list.filter((m) => addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    const rest = list.filter((m) => !addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    return [...added, ...rest];
  };

  const filteredModels = useMemo(() => {
    const list = parsedQuery.isEmpty ? pureModels : pureModels.filter((m) => matchesSearch(m, parsedQuery));
    return sortModels(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pureModels, parsedQuery, addedModelValues]);

  const visibleUnadded = useMemo(
    () => filteredModels.filter((m) => !addedModelValues.includes(m.value)),
    [filteredModels, addedModelValues]
  );
  const visibleAdded = useMemo(
    () => filteredModels.filter((m) => addedModelValues.includes(m.value)),
    [filteredModels, addedModelValues]
  );

  const handleSelectAllVisible = () => {
    if (visibleUnadded.length === 0) return;
    if (onSelectBatch) onSelectBatch(visibleUnadded);
    else visibleUnadded.forEach((model) => onSelect(model));
  };

  const handleDeselectAllVisible = () => {
    if (visibleAdded.length === 0) return;
    if (onDeselectBatch) onDeselectBatch(visibleAdded);
    else if (onDeselect) visibleAdded.forEach((model) => onDeselect(model));
  };

  const handleSelect = (model: PickerModel) => {
    const value = model?.value || model?.name;
    const isAdded = addedModelValues.includes(value);
    if (isAdded && onDeselect) onDeselect(model);
    else onSelect(model);
    if (closeOnSelect) {
      onClose();
      setSearchQuery("");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setSearchQuery("");
      }}
      title={title}
      size={size}
      className="p-4!"
      footer={null}
    >
      {/* Info bar */}
      <div className="flex items-center gap-2 mb-3 px-2.5 py-2 bg-primary/8 border border-primary/20 rounded-lg text-xs text-text-muted">
        <span className="material-symbols-outlined text-primary shrink-0" style={{ fontSize: "14px" }}>info</span>
        <span>
          Click to add, click again to remove. Search supports exclusions (e.g. claude -haiku) and RegEx (/pattern/).
        </span>
      </div>

      {/* Search & batch actions */}
      <div className="mb-3 space-y-2">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search models (e.g. claude -haiku, !embed, /regex/)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-20 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {parsedQuery.isRegex && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-mono font-medium">
                regex
              </span>
            )}
            {parsedQuery.negativeTerms.length > 0 && !parsedQuery.isRegex && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 font-mono font-medium">
                !exclude
              </span>
            )}
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-text-muted hover:text-text-main cursor-pointer p-0.5 rounded"
                title="Clear search"
              >
                <span className="material-symbols-outlined text-[14px] leading-none">close</span>
              </button>
            )}
          </div>
        </div>

        {!closeOnSelect && filteredModels.length > 0 && (
          <div className="flex items-center justify-between px-1 text-[11px] text-text-muted">
            <span className="flex items-center gap-1.5">
              <span>{filteredModels.length} models</span>
              {addedModelValues.length > 0 && (
                <span className="text-primary font-medium">({addedModelValues.length} selected)</span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              {visibleUnadded.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectAllVisible}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                  title="Select all filtered models"
                >
                  Select All ({visibleUnadded.length})
                </button>
              )}
              {visibleAdded.length > 0 && (
                <button
                  type="button"
                  onClick={handleDeselectAllVisible}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-border/40 text-text-muted hover:text-text-main hover:bg-border/60 transition-colors cursor-pointer"
                  title="Deselect all filtered models"
                >
                  Deselect All ({visibleAdded.length})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Models grouped — compact */}
      <div className="max-h-[400px] overflow-y-auto space-y-3">
        {/* Combos section - always first */}
        {filteredCombos.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <span className="material-symbols-outlined text-primary text-[14px]">layers</span>
              <span className="text-xs font-medium text-primary">Combos</span>
              <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCombos.map((combo) => {
                const isSelected = selectedModel === combo.name;
                return (
                  <button
                    key={combo.id}
                    onClick={() => handleSelect({ id: combo.name, name: combo.name, value: combo.name })}
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer flex items-center gap-1
                      ${isSelected
                        ? "bg-primary text-white border-primary"
                        : addedModelValues.includes(combo.name)
                          ? "bg-primary border-primary text-white hover:bg-primary-hover"
                          : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {addedModelValues.includes(combo.name) && (
                      <span className="material-symbols-outlined leading-none" style={{ fontSize: "10px" }}>check</span>
                    )}
                    {combo.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Models group */}
        {filteredModels.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5 z-10">
              <span className="inline-flex items-center justify-center size-[14px] rounded-sm bg-brand-500 text-white text-[9px] font-bold leading-none">M</span>
              <span className="text-xs font-medium text-primary">Models</span>
              <span className="text-[10px] text-text-muted">({filteredModels.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredModels.map((model) => {
                const isSelected = selectedModel === model.value;
                return (
                  <button
                    key={model.value}
                    onClick={() => handleSelect(model)}
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer
                      ${isSelected
                        ? "bg-primary text-white border-primary"
                        : addedModelValues.includes(model.value)
                          ? "bg-primary border-primary text-white hover:bg-primary-hover"
                          : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    <span className="flex items-center gap-1">
                      {addedModelValues.includes(model.value) && (
                        <span className="material-symbols-outlined leading-none" style={{ fontSize: "10px" }}>check</span>
                      )}
                      {model.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {filteredModels.length === 0 && filteredCombos.length === 0 && (
          <div className="text-center py-4 text-text-muted">
            <span className="material-symbols-outlined text-2xl mb-1 block">
              search_off
            </span>
            <p className="text-xs">No models found</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
