/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from 'react';
import '../CSS/FileExplorerImageLightbox.css';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const SWIPE_THRESHOLD = 56;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const clampView = ({ x, y, scale }, viewport) => ({
  x: clamp(x, viewport.width * (1 - scale), 0),
  y: clamp(y, viewport.height * (1 - scale), 0),
  scale,
});

/**
 * API-free image preview for any file explorer.
 *
 * The parent owns file delivery and navigation. Render this component only
 * while an image is selected, then pass callbacks for close, download, and
 * optional previous/next navigation.
 */
function FileExplorerImageLightbox({
  title = 'Image preview',
  imageUrl = '',
  loading = false,
  loadingLabel = '',
  error = '',
  onClose,
  onDownload,
  onPrevious,
  onNext,
}) {
  const viewportRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const viewRef = useRef({ scale: MIN_ZOOM, x: 0, y: 0 });
  const [view, setView] = useState(viewRef.current);

  const updateView = (nextView) => {
    viewRef.current = nextView;
    setView(nextView);
  };

  const resetView = () => updateView({ scale: MIN_ZOOM, x: 0, y: 0 });

  const close = () => onClose?.();

  useEffect(() => {
    pointersRef.current.clear();
    gestureRef.current = null;
    const initialView = { scale: MIN_ZOOM, x: 0, y: 0 };
    viewRef.current = initialView;
    setView(initialView);
  }, [imageUrl]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      } else if (event.key === 'ArrowLeft' && onPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === 'ArrowRight' && onNext) {
        event.preventDefault();
        onNext();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNext, onPrevious]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const createGesture = () => {
    const viewport = viewportRef.current?.getBoundingClientRect();
    const pointers = Array.from(pointersRef.current, ([pointerId, point]) => ({ pointerId, ...point }));
    const currentView = viewRef.current;
    if (!viewport || !pointers.length) {
      gestureRef.current = null;
      return;
    }

    if (pointers.length === 1) {
      gestureRef.current = {
        type: 'pan',
        pointerId: pointers[0].pointerId,
        startX: pointers[0].clientX,
        startY: pointers[0].clientY,
        originX: currentView.x,
        originY: currentView.y,
        originScale: currentView.scale,
      };
      return;
    }

    const [firstPointer, secondPointer] = pointers;
    const firstX = firstPointer.clientX - viewport.left;
    const firstY = firstPointer.clientY - viewport.top;
    const secondX = secondPointer.clientX - viewport.left;
    const secondY = secondPointer.clientY - viewport.top;
    gestureRef.current = {
      type: 'pinch',
      firstPointerId: firstPointer.pointerId,
      secondPointerId: secondPointer.pointerId,
      startDistance: Math.hypot(secondX - firstX, secondY - firstY),
      startCenterX: (firstX + secondX) / 2,
      startCenterY: (firstY + secondY) / 2,
      originX: currentView.x,
      originY: currentView.y,
      originScale: currentView.scale,
    };
  };

  const zoomAtPointer = (event) => {
    event.preventDefault();
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!viewport) return;

    const pointerX = event.clientX - viewport.left;
    const pointerY = event.clientY - viewport.top;
    const currentView = viewRef.current;
    const scale = clamp(currentView.scale * Math.exp(-event.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
    const scaleChange = scale / currentView.scale;
    updateView(clampView({
      x: pointerX - ((pointerX - currentView.x) * scaleChange),
      y: pointerY - ((pointerY - currentView.y) * scaleChange),
      scale,
    }, viewport));
  };

  const beginGesture = (event) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
    });
    createGesture();
  };

  const moveGesture = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
    });

    const gesture = gestureRef.current;
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!gesture || !viewport) return;
    event.preventDefault();

    if (gesture.type === 'pinch') {
      const firstPointer = pointersRef.current.get(gesture.firstPointerId);
      const secondPointer = pointersRef.current.get(gesture.secondPointerId);
      if (!firstPointer || !secondPointer || gesture.startDistance === 0) return;
      const firstX = firstPointer.clientX - viewport.left;
      const firstY = firstPointer.clientY - viewport.top;
      const secondX = secondPointer.clientX - viewport.left;
      const secondY = secondPointer.clientY - viewport.top;
      const distance = Math.hypot(secondX - firstX, secondY - firstY);
      const centerX = (firstX + secondX) / 2;
      const centerY = (firstY + secondY) / 2;
      const scale = clamp(gesture.originScale * (distance / gesture.startDistance), MIN_ZOOM, MAX_ZOOM);
      const scaleChange = scale / gesture.originScale;
      updateView(clampView({
        x: centerX - ((gesture.startCenterX - gesture.originX) * scaleChange),
        y: centerY - ((gesture.startCenterY - gesture.originY) * scaleChange),
        scale,
      }, viewport));
      return;
    }

    if (gesture.pointerId !== event.pointerId || viewRef.current.scale <= MIN_ZOOM) return;
    updateView(clampView({
      x: gesture.originX + event.clientX - gesture.startX,
      y: gesture.originY + event.clientY - gesture.startY,
      scale: viewRef.current.scale,
    }, viewport));
  };

  const endGesture = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const gesture = gestureRef.current;
    const horizontalDistance = gesture?.type === 'pan' ? event.clientX - gesture.startX : 0;
    const verticalDistance = gesture?.type === 'pan' ? event.clientY - gesture.startY : 0;
    const isSwipe = event.pointerType === 'touch'
      && gesture?.type === 'pan'
      && gesture.pointerId === event.pointerId
      && gesture.originScale <= MIN_ZOOM
      && Math.abs(horizontalDistance) >= SWIPE_THRESHOLD
      && Math.abs(horizontalDistance) > Math.abs(verticalDistance);

    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (isSwipe && horizontalDistance < 0 && onNext) onNext();
    if (isSwipe && horizontalDistance > 0 && onPrevious) onPrevious();
    createGesture();
  };

  return (
    <section className="file-explorer-image-lightbox" role="dialog" aria-modal="true" aria-label={`Image preview: ${title}`}>
      <header className="file-explorer-image-lightbox-header">
        {onDownload ? <button className="file-explorer-image-text-button" type="button" onClick={onDownload}>Download</button> : <span />}
        {loading && <p className="file-explorer-image-lightbox-status" role="status">{loadingLabel || 'Loading image...'}</p>}
        <button className="file-explorer-image-text-button" type="button" onClick={close} autoFocus>Close</button>
      </header>
      <div className="file-explorer-image-lightbox-content" ref={viewportRef} onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}>
        {error && <p className="file-explorer-image-lightbox-error" role="alert">{error}</p>}
        {!error && imageUrl && (
          <img
            className="file-explorer-image-lightbox-image"
            src={imageUrl}
            alt={title}
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
            onDoubleClick={resetView}
            onWheel={zoomAtPointer}
            onPointerDown={beginGesture}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          />
        )}
      </div>
      <footer className="file-explorer-image-lightbox-nav">
        <button type="button" onClick={onPrevious} disabled={!onPrevious}>Previous</button>
        <span title={title}>{title}</span>
        <button type="button" onClick={onNext} disabled={!onNext}>Next</button>
      </footer>
    </section>
  );
}

export default FileExplorerImageLightbox;
