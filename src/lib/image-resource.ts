"use client";

import { useMemo, useSyncExternalStore } from "react";

interface ImageResource {
  image: HTMLImageElement | null;
  error: Error | null;
  loading: boolean;
  readonly listeners: Set<() => void>;
}

const resources = new Map<string, ImageResource>();

function getResource(src: string): ImageResource {
  const existing = resources.get(src);
  if (existing) {
    return existing;
  }

  const resource: ImageResource = {
    image: null,
    error: null,
    loading: false,
    listeners: new Set(),
  };
  resources.set(src, resource);
  return resource;
}

function notify(resource: ImageResource): void {
  resource.listeners.forEach((listener) => {
    listener();
  });
}

function startLoading(src: string, resource: ImageResource): void {
  if (resource.loading || resource.image || typeof window === "undefined") {
    return;
  }

  resource.loading = true;
  const image = new window.Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.addEventListener(
    "load",
    () => {
      resource.image = image;
      resource.error = null;
      resource.loading = false;
      notify(resource);
    },
    { once: true },
  );
  image.addEventListener(
    "error",
    () => {
      resource.error = new Error(`Unable to load image: ${src}`);
      resource.loading = false;
      notify(resource);
    },
    { once: true },
  );
  image.src = src;
}

export function preloadImage(src: string): void {
  if (!src) {
    return;
  }
  const resource = getResource(src);
  startLoading(src, resource);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  if (!src) {
    return Promise.reject(new Error("Image source is empty"));
  }

  const resource = getResource(src);
  if (resource.image) {
    return Promise.resolve(resource.image);
  }
  if (resource.error) {
    return Promise.reject(resource.error);
  }

  startLoading(src, resource);
  return new Promise((resolve, reject) => {
    const onChange = (): void => {
      if (resource.image) {
        resource.listeners.delete(onChange);
        resolve(resource.image);
      } else if (resource.error) {
        resource.listeners.delete(onChange);
        reject(resource.error);
      }
    };
    resource.listeners.add(onChange);
  });
}

export function useImageResource(src: string): HTMLImageElement | null {
  const resource = useMemo(() => getResource(src), [src]);

  return useSyncExternalStore(
    (listener) => {
      resource.listeners.add(listener);
      startLoading(src, resource);
      return () => resource.listeners.delete(listener);
    },
    () => resource.image,
    () => null,
  );
}
