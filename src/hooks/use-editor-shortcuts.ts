"use client";

import { useEffect, useState } from "react";

import { useEditorStore } from "@/store/editor-store";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function useEditorShortcuts(): { isSpacePressed: boolean } {
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Space" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      if (isEditableTarget(event.target) || event.repeat) {
        return;
      }

      const store = useEditorStore.getState();
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (event.key === "Delete" || event.key === "Backspace") {
        if (store.selectedLayerIds.length > 0) {
          event.preventDefault();
          store.removeLayers();
        }
        return;
      }

      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
        return;
      }

      if (modifier && key === "y") {
        event.preventDefault();
        store.redo();
        return;
      }

      if (modifier && key === "g") {
        event.preventDefault();
        store.groupUngroup();
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    const handleBlur = (): void => {
      setIsSpacePressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  return { isSpacePressed };
}
