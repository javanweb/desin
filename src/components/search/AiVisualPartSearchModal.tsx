import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Camera,
  Image as GalleryImage,
  SwitchCamera,
  UploadCloud,
  ArrowRight,
  AlertCircle,
  ChevronLeft,
  ChevronDown,
  X,
  Zap,
  RotateCcw,
  Wrench,
  Phone,
  MessageCircle,
  ScanSearch,
  History,
  HelpCircle,
  Sun,
  Focus,
  ZoomIn,
  Search,
  Sparkles,
} from 'lucide-react';
import { apiUrl } from '../../config/apiConfig';
import {
  aiVisualSearchService,
  type AiAnalysisStage,
  type AiPartAnalysisResult,
} from '../../services/aiVisualSearchService';
import {
  adoptCustomerDeviceImage,
  customerImageBlobToDataUrl,
  getCustomerDeviceImage,
  getCustomerDeviceImageMetadata,
  saveCustomerDeviceImage,
} from '../../services/customerImageVault';
import {
  completeCustomerImageIdentification,
  createCustomerImageIdentification,
  selectCustomerImageProduct,
} from '../../services/customerIntelligenceService';
import { pricingCreditService } from '../../services/pricingCreditService';
import { useAuth } from '../../context/AuthContext';
import { formatPrice, toPersianDigits } from '../../utils/formatters';
import {
  prepareFastVisionDetectionUrl,
  renderSegmentedVisionCutout,
  type SegmentedVisionCutout,
} from '../../utils/cropVisionImage';
import type { ImageRegion } from '../../utils/imageRegion';
import { buildVisionConsultationPrompt } from '../../utils/visionConsultationPrompt';
import {
  analyzeImageAutoContour,
  fuseDetectionCandidates,
  inferVisualDescriptor,
  isPointInsidePolygon,
  refineAutoContoursWithAiMask,
  refineContourInsideRegion,
  segmentPartAtTapPoint,
  type AlphaMaskData,
  type ContourPoint,
  type DetectedPartContour,
} from '../../utils/smartPartContour';
import { preloadClientAiSegmentation } from '../../utils/clientAiSegmentation';
import { useOnnxPartSegmentation } from './PartIdentificationProvider';
import { memberPath } from '../storefront/MemberAccess';
import { CatalogResultImage } from './CatalogResultImage';
import { LocalModelResults } from './LocalModelResults';
import {
  loadVisionRecentSearches,
  recordVisionRecentSearch,
  type VisionRecentSearchItem,
} from './visionRecentHistory';
import './industrial-scan.css';

const OPTICAL_BENCH_ART = '/src/assets/images/optical_inspection_bench_1795017104316.jpg';
const CAMERA_TIPS_SEEN_KEY = 'forza_camera_tips_seen_v1';

const LazyCustomPartRequestModal = lazy(() =>
  import('../home/CustomPartRequestModal').then((module) => ({
    default: module.CustomPartRequestModal,
  })),
);

const MAX_MANUFACTURING_IMAGE_BYTES = 8 * 1024 * 1024;

async function createManufacturingImageFile(blob: Blob, originalName: string): Promise<File> {
  if (!blob.size || !blob.type.startsWith('image/')) {
    throw new Error('تصویر قطعه برای پیوست درخواست ساخت معتبر نیست.');
  }
  const safeBase =
    (originalName || 'forza-part-image')
      .split(/[\\/]/)
      .pop()!
      .replace(/[.][^.]+$/, '')
      .slice(0, 100) || 'forza-part-image';
  const mime = blob.type.split(';')[0].toLowerCase();
  const extension = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  if (
    blob.size <= MAX_MANUFACTURING_IMAGE_BYTES &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(mime)
  ) {
    return new File([blob], safeBase + extension, { type: mime, lastModified: Date.now() });
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const encode = async (maxDimension: number, quality: number): Promise<Blob> => {
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('آماده‌سازی تصویر برای پیوست انجام نشد.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve, reject) =>
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('فشرده‌سازی تصویر ناموفق بود.'))),
          'image/webp',
          quality,
        ),
      );
    };
    let compressed = await encode(2400, 0.86);
    if (compressed.size > MAX_MANUFACTURING_IMAGE_BYTES) compressed = await encode(1800, 0.72);
    if (compressed.size > MAX_MANUFACTURING_IMAGE_BYTES) {
      throw new Error('حجم تصویر برای ثبت درخواست ساخت زیاد است.');
    }
    return new File([compressed], safeBase + '.webp', {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}

export interface AiVisualPartSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  fullScreen?: boolean;
  initialCamera?: boolean;
  standalone?: boolean;
  onAnalysisResult?: (result: AiPartAnalysisResult, image: string) => void;
}

type StudioScreen = 'entry' | 'camera' | 'results';

type ManufacturingRequestDraft = {
  file: File;
  partName: string;
  partType: string;
  dimensions: string;
  alloyCondition: string;
  notes: string;
};

const CAMERA_ZOOM_PRESETS = [1, 1.5, 2, 3];

export const AiVisualPartSearchModal: React.FC<AiVisualPartSearchModalProps> = ({
  isOpen,
  onClose,
  initialCamera = false,
  standalone = false,
  onAnalysisResult,
}) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { segmentPart: segmentWithOnnx } = useOnnxPartSegmentation();

  const [screen, setScreen] = useState<StudioScreen>(initialCamera ? 'camera' : 'entry');

  // Image & automatic cutout state (zero manual corner dragging)
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedSampleHint, setSelectedSampleHint] = useState('');
  const [selectedOriginalName, setSelectedOriginalName] = useState('');
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string | null>(null);
  const [queryRegion, setQueryRegion] = useState<ImageRegion>({
    x: 0.16,
    y: 0.16,
    width: 0.68,
    height: 0.68,
  });
  const [activePolygon, setActivePolygon] = useState<ContourPoint[] | null>(null);
  const [detectedCandidates, setDetectedCandidates] = useState<DetectedPartContour[]>([]);
  const [activeCandidateId, setActiveCandidateId] = useState<string>('auto-1');
  const [isDetectingParts, setIsDetectingParts] = useState(false);
  const [isAiSegmenting, setIsAiSegmenting] = useState(false);
  const [isTracingContour, setIsTracingContour] = useState(false);
  const [edgeLockFlash, setEdgeLockFlash] = useState<number | null>(null);
  const [tapRipple, setTapRipple] = useState<{ x: number; y: number; key: number } | null>(null);
  const [regionDetectionId, setRegionDetectionId] = useState<string | null>(null);

  // Vault / upload state
  const [localImageId, setLocalImageId] = useState<string | null>(null);
  const [imageEventId, setImageEventId] = useState<string | null>(null);
  const [temporaryImageDataUrl, setTemporaryImageDataUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('image/jpeg');

  // Live catalog match state
  const [isMatching, setIsMatching] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AiPartAnalysisResult | null>(null);
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);

  // Recent searches (localStorage)
  const [recentSearches, setRecentSearches] = useState<VisionRecentSearchItem[]>(() =>
    loadVisionRecentSearches(),
  );
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Camera state + Pinch Zoom + First-Time Guide
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [canUseTorch, setCanUseTorch] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [cameraNotice, setCameraNotice] = useState('');
  const [cameraZoom, setCameraZoom] = useState(1);
  const [cameraGuideOpen, setCameraGuideOpen] = useState(false);

  // Custom manufacturing request & general errors
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [customRequestDraft, setCustomRequestDraft] = useState<ManufacturingRequestDraft | null>(null);
  const [customRequestOpen, setCustomRequestOpen] = useState(false);
  const [isPreparingCustomRequest, setIsPreparingCustomRequest] = useState(false);

  // Refs for cancellation & streams & pinch zoom
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraGalleryRef = useRef<HTMLInputElement | null>(null);
  const cameraStageRef = useRef<HTMLDivElement | null>(null);
  const lensBoxRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraZoomRef = useRef(1);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const hwZoomRangeRef = useRef<{ min: number; max: number } | null>(null);

  const cameraRequestRef = useRef(0);
  const pipelineSequenceRef = useRef(0);
  const customRequestSequenceRef = useRef(0);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const detectAbortRef = useRef<AbortController | null>(null);
  const userInteractedRef = useRef(false);
  const aiAlphaDataRef = useRef<AlphaMaskData | null>(null);
  const aiContoursRef = useRef<DetectedPartContour[]>([]);
  const geminiPartsRef = useRef<DetectedPartContour[]>([]);
  const latestRegionRef = useRef<ImageRegion>({ x: 0.16, y: 0.16, width: 0.68, height: 0.68 });
  const latestPolygonRef = useRef<ContourPoint[] | null>(null);
  const latestImageUrlRef = useRef<string | null>(null);
  const mobileResultsAnchorRef = useRef<HTMLDivElement | null>(null);
  const edgeLockTimerRef = useRef<number | null>(null);

  const triggerEdgeLockAnimation = () => {
    const key = Date.now();
    setEdgeLockFlash(key);
    if (edgeLockTimerRef.current) {
      window.clearTimeout(edgeLockTimerRef.current);
    }
    edgeLockTimerRef.current = window.setTimeout(() => {
      setEdgeLockFlash((cur) => (cur === key ? null : cur));
    }, 1100);
  };

  useEffect(() => {
    latestImageUrlRef.current = selectedImage;
  }, [selectedImage]);

  useEffect(() => {
    latestRegionRef.current = queryRegion;
  }, [queryRegion]);

  useEffect(() => {
    latestPolygonRef.current = activePolygon;
  }, [activePolygon]);

  useEffect(() => {
    cameraZoomRef.current = cameraZoom;
  }, [cameraZoom]);

  // Body scroll lock & Escape handler when in overlay mode
  useEffect(() => {
    if (!isOpen) return;
    document.body.classList.add('sanat-visual-search-open');
    const prevOverflow = !standalone ? document.body.style.overflow : '';
    if (!standalone) document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !standalone && !customRequestOpen) {
        stopCameraStream();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.classList.remove('sanat-visual-search-open');
      if (!standalone) document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, standalone, customRequestOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      cameraRequestRef.current++;
      stopCameraStream();
      pipelineSequenceRef.current++;
      customRequestSequenceRef.current++;
      analyzeAbortRef.current?.abort();
      analyzeAbortRef.current = null;
      detectAbortRef.current?.abort();
      detectAbortRef.current = null;
      setCustomRequestOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void preloadClientAiSegmentation();
    const ctrl = new AbortController();
    fetch(apiUrl('/api/ai/local-vision-status'), { signal: ctrl.signal, cache: 'no-store' }).catch(
      () => undefined,
    );
    return () => ctrl.abort();
  }, [isOpen]);

  useEffect(() => {
    return () => {
      pipelineSequenceRef.current++;
      customRequestSequenceRef.current++;
      analyzeAbortRef.current?.abort();
      detectAbortRef.current?.abort();
      if (edgeLockTimerRef.current) {
        window.clearTimeout(edgeLockTimerRef.current);
      }
      stopCameraStream();
      if (latestImageUrlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(latestImageUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !initialCamera) return;
    void startCamera();
  }, [isOpen, initialCamera]);

  // Dedicated Pinch-to-Zoom ONLY on the camera viewfinder stage (stops browser page zoom!)
  const applyCameraZoom = (nextZoomRaw: number) => {
    const clamped = Math.max(1, Math.min(4, Number(nextZoomRaw.toFixed(2))));
    cameraZoomRef.current = clamped;
    setCameraZoom(clamped);

    const track = cameraStreamRef.current?.getVideoTracks()[0];
    const range = hwZoomRangeRef.current;
    if (track && range && range.max > range.min) {
      const targetHw = Math.max(
        range.min,
        Math.min(range.max, range.min + (clamped - 1) * ((range.max - range.min) / 3)),
      );
      void track
        .applyConstraints({
          advanced: [{ zoom: targetHw } as MediaTrackConstraintSet & { zoom: number }],
        })
        .catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!isOpen || screen !== 'camera') return;
    const el = cameraStageRef.current;
    if (!el) return;

    const getTouchDistance = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinchStartDistRef.current = getTouchDistance(e.touches);
        pinchStartZoomRef.current = cameraZoomRef.current;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDistRef.current) {
        e.preventDefault();
        const dist = getTouchDistance(e.touches);
        const ratio = dist / Math.max(10, pinchStartDistRef.current);
        applyCameraZoom(pinchStartZoomRef.current * ratio);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStartDistRef.current = null;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.004;
      applyCameraZoom(cameraZoomRef.current + delta);
    };

    const blockBrowserGesture = (e: Event) => {
      e.preventDefault();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('gesturestart', blockBrowserGesture, { passive: false });
    document.addEventListener('gesturechange', blockBrowserGesture, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      document.removeEventListener('gesturestart', blockBrowserGesture);
      document.removeEventListener('gesturechange', blockBrowserGesture);
    };
  }, [isOpen, screen]);

  if (!isOpen) return null;

  function stopCameraStream() {
    cameraRequestRef.current++;
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    hwZoomRangeRef.current = null;
    if (videoRef.current?.srcObject) {
      const s = videoRef.current.srcObject as MediaStream;
      s.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraReady(false);
    setCanUseTorch(false);
    setTorchEnabled(false);
    setCameraZoom(1);
    cameraZoomRef.current = 1;
  }

  const dismissCameraGuide = () => {
    setCameraGuideOpen(false);
    try {
      window.localStorage.setItem(CAMERA_TIPS_SEEN_KEY, '1');
    } catch {
      // ignore storage error
    }
  };

  /**
   * Fetches catalog matches for a specific tight cutout region + updates cropped thumbnail & history.
   */
  const runRegionVisualMatch = async (opts: {
    imageSrc: string;
    region: ImageRegion;
    polygon?: ContourPoint[];
    alphaData?: AlphaMaskData | null;
    seq: number;
    displayUrl: string;
    sampleHint?: string;
    originalName?: string;
    mime?: string;
    stage?: AiAnalysisStage;
    savedLocalImageId?: string | null;
    detectionId?: string | null;
  }) => {
    analyzeAbortRef.current?.abort();
    const analyzeController = new AbortController();
    analyzeAbortRef.current = analyzeController;

    setIsMatching(true);
    setErrorMessage('');

    try {
      const effectiveAlpha = opts.alphaData !== undefined ? opts.alphaData : null;
      const [cutout, visualDesc] = await Promise.all([
        renderSegmentedVisionCutout(
          opts.imageSrc,
          opts.region,
          0,
          opts.polygon,
          effectiveAlpha,
        ).catch((): SegmentedVisionCutout => ({})),
        inferVisualDescriptor(opts.imageSrc, opts.region, 0, opts.polygon).catch(() => undefined),
      ]);

      if (analyzeController.signal.aborted || opts.seq !== pipelineSequenceRef.current) return;
      const previewCutoutUrl = cutout.previewUrl || cutout.modelInputUrl;
      if (previewCutoutUrl) setCroppedPreviewUrl(previewCutoutUrl);

      let activeImageEventId: string | null = imageEventId;
      if (currentUser && opts.savedLocalImageId && !activeImageEventId) {
        try {
          await adoptCustomerDeviceImage(opts.savedLocalImageId, currentUser.id);
          const meta = await getCustomerDeviceImageMetadata(opts.savedLocalImageId);
          if (meta) {
            const ev = await createCustomerImageIdentification({
              deviceImageId: meta.id,
              sha256: meta.sha256,
              mimeType: meta.mimeType,
              sizeBytes: meta.sizeBytes,
              originalName: meta.originalName,
            });
            activeImageEventId = ev.id;
            setImageEventId(ev.id);
          }
        } catch {
          // optional event logging in UI-only mode
        }
      }

      if (analyzeController.signal.aborted || opts.seq !== pipelineSequenceRef.current) return;
      const payloadImage = cutout.modelInputUrl || cutout.previewUrl || opts.imageSrc;
      const resolvedPayloadMime =
        payloadImage.match(/^data:([^;]+);base64,/i)?.[1] || opts.mime || mimeType;
      const croppedDataUrl = previewCutoutUrl || payloadImage;

      const result = await aiVisualSearchService.analyzePartWithAi(
        {
          imageBase64: payloadImage.startsWith('data:') ? payloadImage : undefined,
          imageUrl: !opts.displayUrl.startsWith('blob:') ? opts.displayUrl : undefined,
          mimeType: resolvedPayloadMime,
          sampleHint: opts.sampleHint !== undefined ? opts.sampleHint : selectedSampleHint || undefined,
          originalName:
            opts.originalName !== undefined ? opts.originalName : selectedOriginalName || undefined,
          stage: opts.stage || 'quick',
          observationOnly: false,
          region: opts.region,
          detectionId: opts.detectionId || regionDetectionId || undefined,
          fullImage: false,
          includeNearest: false,
          visualDescriptor: visualDesc ? { ...visualDesc } : undefined,
        },
        undefined,
        analyzeController.signal,
      );

      if (analyzeController.signal.aborted || opts.seq !== pipelineSequenceRef.current) return;

      if (activeImageEventId) {
        void completeCustomerImageIdentification(activeImageEventId, {
          status: result.matchedProducts?.length ? 'completed' : 'unmatched',
          detectedPartType: result.summary?.detectedPartType,
          summary: result.summary?.whatYouSee || result.summary?.visualAnalysis,
          technicalAdvice: result.technicalAdvice,
          matchedProductCodes: (result.matchedProducts || []).map((m) => m.code),
          similarProductCodes: (result.similarCandidates || []).map((s) => s.code),
          confidence: result.summary?.confidence,
        }).catch(() => undefined);
      }

      const firstMatch = result.matchedProducts?.[0];
      const historyThumb =
        (!opts.displayUrl.startsWith('blob:') ? opts.displayUrl : null) ||
        croppedDataUrl ||
        firstMatch?.image ||
        opts.displayUrl;

      if (historyThumb) {
        setRecentSearches(
          recordVisionRecentSearch({
            title: result.summary?.partFamilyFarsi || result.summary?.detectedPartType || 'قطعه صنعتی',
            subtitle: firstMatch
              ? `${firstMatch.code} · ${firstMatch.brand}`
              : result.summary?.detectedProfile || '',
            imageUrl: historyThumb,
            code: firstMatch?.code,
            partHint: opts.sampleHint || result.summary?.detectedPartType,
          }),
        );
      }

      setAnalysisResult(result);
      if (result.matchedProducts?.length || result.similarCandidates?.length) {
        onAnalysisResult?.(result, croppedDataUrl || payloadImage);
      }
    } catch (err: any) {
      if (
        err?.name === 'AbortError' ||
        analyzeController.signal.aborted ||
        opts.seq !== pipelineSequenceRef.current
      ) {
        return;
      }
      setErrorMessage(err?.message || 'تطبیق تصویر کامل نشد؛ لطفاً دوباره تلاش کنید.');
    } finally {
      if (analyzeAbortRef.current === analyzeController) {
        analyzeAbortRef.current = null;
      }
      if (opts.seq === pipelineSequenceRef.current) {
        setIsMatching(false);
      }
    }
  };

  /**
   * Instant-First Multi-Part Detection + Background Gemini Refinement:
   * Immediately isolates parts using local browser CV (~40ms), then runs
   * Gemini Vision in background to enrich part family labels & catch subtle parts.
   */
  const enrichWithGeminiInBackground = async (
    detectSrc: string,
    fullSrc: string,
    seq: number,
    localCandidates: DetectedPartContour[],
    displayUrl: string,
  ) => {
    detectAbortRef.current?.abort();
    const detectController = new AbortController();
    detectAbortRef.current = detectController;

    try {
      const serverDetection = await aiVisualSearchService
        .detectImageRegions(detectSrc, detectController.signal)
        .catch(() => null);
      if (detectController.signal.aborted || seq !== pipelineSequenceRef.current) return;
      const serverParts = serverDetection?.detectedParts || [];
      if (serverDetection?.detectionId) {
        setRegionDetectionId(serverDetection.detectionId);
      }
      if (serverParts.length === 0) return;

      const refinedServerParts = await Promise.all(
        serverParts.map((part) =>
          refineContourInsideRegion(fullSrc, part.region, part.center, 0, {
            id: part.id,
            label: part.label,
            partFamily: part.partFamily,
          }),
        ),
      );
      if (detectController.signal.aborted || seq !== pipelineSequenceRef.current) return;

      geminiPartsRef.current = refinedServerParts;
      const merged = fuseDetectionCandidates(
        aiContoursRef.current,
        refinedServerParts,
        localCandidates,
      );
      if (merged.length === 0) return;

      setDetectedCandidates(merged);
      if (!userInteractedRef.current && merged[0]) {
        const nextPrimary = merged[0];
        const prevRegion = latestRegionRef.current;
        const regionShift =
          Math.abs(nextPrimary.region.x - prevRegion.x) +
          Math.abs(nextPrimary.region.y - prevRegion.y) +
          Math.abs(nextPrimary.region.width - prevRegion.width) +
          Math.abs(nextPrimary.region.height - prevRegion.height);
        const primaryChanged =
          (!nextPrimary.fromAiMask && regionShift > 0.10) || regionShift > 0.12;

        setActiveCandidateId(nextPrimary.id);
        setQueryRegion(nextPrimary.region);
        setActivePolygon(nextPrimary.polygon);

        if (primaryChanged) {
          triggerEdgeLockAnimation();
          void runRegionVisualMatch({
            imageSrc: fullSrc,
            region: nextPrimary.region,
            polygon: nextPrimary.polygon,
            alphaData: nextPrimary.fromAiMask ? aiAlphaDataRef.current : null,
            seq,
            displayUrl,
            sampleHint: nextPrimary.label || '',
            detectionId: serverDetection?.detectionId,
          });
        }
      }
    } catch {
      // keep instant / client-AI contours silently
    } finally {
      if (detectAbortRef.current === detectController) {
        detectAbortRef.current = null;
      }
    }
  };

  /**
   * Direct Entry into Lens + Similar Products ('results'):
   * Runs lightweight client-side AI segmentation (`@imgly/background-removal` isnet_quint8)
   * alongside instant local CV & Gemini Vision detection so part boundaries lock accurately
   * and the background becomes uniformly pure white (#FFFFFF).
   */
  const launchDirectVisualResults = async (
    displayUrl: string,
    source: string | Blob,
    opts?: {
      originalName?: string;
      sampleHint?: string;
      mime?: string;
    },
  ) => {
    const seq = ++pipelineSequenceRef.current;
    userInteractedRef.current = false;
    aiAlphaDataRef.current = null;
    aiContoursRef.current = [];
    geminiPartsRef.current = [];
    analyzeAbortRef.current?.abort();
    detectAbortRef.current?.abort();

    if (selectedImage?.startsWith('blob:') && selectedImage !== displayUrl) {
      URL.revokeObjectURL(selectedImage);
    }
    stopCameraStream();

    setErrorMessage('');
    setSelectedImage(displayUrl);
    setCroppedPreviewUrl(null);
    setDetectedCandidates([]);
    setActivePolygon(null);
    setActiveCandidateId('auto-1');
    setTapRipple(null);
    setMobileSheetExpanded(false);
    setLocalImageId(null);
    setImageEventId(null);
    setSelectedOriginalName(opts?.originalName || 'customer-image');
    setSelectedSampleHint(opts?.sampleHint || '');
    setMimeType(opts?.mime || 'image/jpeg');
    setIsDetectingParts(true);
    setIsAiSegmenting(true);
    setIsTracingContour(false);
    setEdgeLockFlash(null);
    setIsMatching(true);
    setScreen('results');

    try {
      let resolvedUrl =
        typeof source === 'string' && source.startsWith('data:') ? source : displayUrl;
      let savedId: string | null = null;

      try {
        const blob =
          typeof source === 'string'
            ? await fetch(source, { credentials: 'same-origin', cache: 'no-store' }).then((r) => {
                if (!r.ok) throw new Error('خواندن تصویر انجام نشد.');
                return r.blob();
              })
            : source;

        resolvedUrl = await customerImageBlobToDataUrl(blob);
        void saveCustomerDeviceImage(
          blob,
          currentUser?.id || 'guest',
          opts?.originalName || 'customer-image',
        )
          .then((saved) => {
            if (seq !== pipelineSequenceRef.current) return;
            savedId = saved.id;
            setLocalImageId(saved.id);
            setMimeType(saved.mimeType);
          })
          .catch(() => null);
      } catch {
        // Fallback to direct displayUrl if blob fetch fails
      }

      if (seq !== pipelineSequenceRef.current) return;
      const fastDetectUrl = await prepareFastVisionDetectionUrl(resolvedUrl, 860);
      if (seq !== pipelineSequenceRef.current) return;
      setTemporaryImageDataUrl(fastDetectUrl);

      // Phase 1: Instant client-side preview contour (~10ms) + kick off local onnxruntime-web segmentation
      const instantCvPromise = analyzeImageAutoContour(fastDetectUrl, 0);
      const aiSegPromise = segmentWithOnnx(fastDetectUrl);

      const instantCv = await instantCvPromise;
      if (seq !== pipelineSequenceRef.current) return;

      setIsDetectingParts(false);
      setIsTracingContour(false);
      setDetectedCandidates(instantCv.candidates);
      setActiveCandidateId(instantCv.primary.id);
      setQueryRegion(instantCv.primary.region);
      setActivePolygon(instantCv.primary.polygon);
      if (instantCv.primary.edgeLocked) {
        triggerEdgeLockAnimation();
      }

      // Phase 2: Run semantic Gemini detection & initial catalog matching in parallel with IS-Net
      void enrichWithGeminiInBackground(
        fastDetectUrl,
        fastDetectUrl,
        seq,
        instantCv.candidates,
        displayUrl,
      );

      // Phase 2b: Run IS-Net in background, then fuse safely via refineAutoContoursWithAiMask
      // so arms/hands/glare NEVER overwrite a compact held industrial part.
      void aiSegPromise
        .then(async (aiSeg) => {
          if (seq !== pipelineSequenceRef.current) return;
          setIsAiSegmenting(false);
          if (!aiSeg) return;

          const alphaData: AlphaMaskData = {
            width: aiSeg.width,
            height: aiSeg.height,
            alphaMask: aiSeg.alphaMask,
          };
          aiAlphaDataRef.current = alphaData;

          const refined = await refineAutoContoursWithAiMask(fastDetectUrl, alphaData, 0);
          if (seq !== pipelineSequenceRef.current) return;

          if (refined.candidates.length === 0) return;
          aiContoursRef.current = refined.candidates;

          const fused = fuseDetectionCandidates(
            refined.candidates,
            geminiPartsRef.current,
            instantCv.candidates,
          );
          if (fused.length === 0) return;

          if (!userInteractedRef.current) {
            const nextPrimary = fused[0];
            const prevRegion = latestRegionRef.current;
            const shift =
              Math.abs(nextPrimary.region.x - prevRegion.x) +
              Math.abs(nextPrimary.region.y - prevRegion.y) +
              Math.abs(nextPrimary.region.width - prevRegion.width) +
              Math.abs(nextPrimary.region.height - prevRegion.height);

            setDetectedCandidates(fused);
            setActiveCandidateId(nextPrimary.id);
            setQueryRegion(nextPrimary.region);
            setActivePolygon(nextPrimary.polygon);

            // Re-run catalog matching when neural fusion meaningfully refines the crop
            if (shift > 0.06 || nextPrimary.fromAiMask) {
              triggerEdgeLockAnimation();
              void runRegionVisualMatch({
                imageSrc: fastDetectUrl,
                region: nextPrimary.region,
                polygon: nextPrimary.polygon,
                alphaData: nextPrimary.fromAiMask ? alphaData : null,
                seq,
                displayUrl,
                sampleHint: nextPrimary.label || opts?.sampleHint,
                originalName: opts?.originalName,
                mime: opts?.mime,
                savedLocalImageId: savedId,
              });
            }
          }
        })
        .catch(() => {
          if (seq === pipelineSequenceRef.current) setIsAiSegmenting(false);
        });

      await runRegionVisualMatch({
        imageSrc: fastDetectUrl,
        region: instantCv.primary.region,
        polygon: instantCv.primary.polygon,
        alphaData: null,
        seq,
        displayUrl,
        sampleHint: instantCv.primary.label || opts?.sampleHint,
        originalName: opts?.originalName,
        mime: opts?.mime,
        savedLocalImageId: savedId,
      });
    } catch {
      if (seq !== pipelineSequenceRef.current) return;
      setIsDetectingParts(false);
      setIsAiSegmenting(false);
      setIsMatching(false);
    }
  };

  /**
   * Computer-Vision Click-to-Trace Selection Handler:
   * - Clicking any pixel on a physical part traces/selects the ENTIRE object via cached CV scene.
   * - Clicking on empty background (no part present) leaves the current/default cutout untouched!
   */
  const handleImagePointSelect = async (normX: number, normY: number, dotCandidate?: DetectedPartContour) => {
    const activeSrc = temporaryImageDataUrl || selectedImage;
    const cutoutBaseSrc = temporaryImageDataUrl || selectedImage || activeSrc;
    if (!activeSrc || !cutoutBaseSrc) return;

    let nextContour: DetectedPartContour;
    let seq: number;

    if (dotCandidate) {
      userInteractedRef.current = true;
      seq = ++pipelineSequenceRef.current;
      setTapRipple({ x: normX * 100, y: normY * 100, key: Date.now() });

      if (dotCandidate.edgeLocked && dotCandidate.polygon.length >= 6) {
        nextContour = dotCandidate;
        setActiveCandidateId(dotCandidate.id);
      } else {
        setIsTracingContour(true);
        const segmented = await segmentPartAtTapPoint(
          activeSrc,
          dotCandidate.center.x,
          dotCandidate.center.y,
          0,
          {
            id: dotCandidate.id,
            label: dotCandidate.label,
            partFamily: dotCandidate.partFamily,
          },
        );
        if (seq !== pipelineSequenceRef.current) return;
        setIsTracingContour(false);
        nextContour = segmented || dotCandidate;
        setActiveCandidateId(nextContour.id);
        setDetectedCandidates((prev) =>
          prev.map((p) => (p.id === dotCandidate.id ? nextContour : p)),
        );
      }
    } else {
      const activeCand = detectedCandidates.find((c) => c.id === activeCandidateId);
      const activeRegion = activeCand?.region || queryRegion;
      const activeArea = activeRegion.width * activeRegion.height;
      const inActiveRect =
        normX >= activeRegion.x &&
        normX <= activeRegion.x + activeRegion.width &&
        normY >= activeRegion.y &&
        normY <= activeRegion.y + activeRegion.height;
      const isInsideActive =
        inActiveRect &&
        (activeCand?.polygon && activeCand.polygon.length >= 6
          ? isPointInsidePolygon(normX, normY, activeCand.polygon)
          : true);

      // Branch 1: Tapping inside an already-selected large whole assembly -> isolate distinct inner sub-part (e.g. center bearing)
      if (isInsideActive && activeArea > 0.20) {
        const innerCand = [...detectedCandidates]
          .filter((c) => {
            if (c.id === activeCandidateId) return false;
            const cArea = c.region.width * c.region.height;
            if (cArea >= activeArea * 0.62) return false;
            const inRect =
              normX >= c.region.x &&
              normX <= c.region.x + c.region.width &&
              normY >= c.region.y &&
              normY <= c.region.y + c.region.height;
            if (!inRect) return false;
            return c.polygon.length >= 6 ? isPointInsidePolygon(normX, normY, c.polygon) : true;
          })
          .sort((a, b) => a.region.width * a.region.height - b.region.width * b.region.height)[0];

        if (innerCand) {
          userInteractedRef.current = true;
          seq = ++pipelineSequenceRef.current;
          setTapRipple({ x: normX * 100, y: normY * 100, key: Date.now() });
          nextContour = innerCand;
          setActiveCandidateId(innerCand.id);
        } else {
          const seqBefore = pipelineSequenceRef.current;
          setIsTracingContour(true);
          const innerSeg = await segmentPartAtTapPoint(activeSrc, normX, normY, 0, undefined, {
            preferInnerAtTap: true,
            outerBound: activeRegion,
          });
          if (seqBefore !== pipelineSequenceRef.current) return;
          setIsTracingContour(false);
          if (!innerSeg) {
            return;
          }

          userInteractedRef.current = true;
          seq = ++pipelineSequenceRef.current;
          setTapRipple({ x: normX * 100, y: normY * 100, key: Date.now() });
          nextContour = innerSeg;
          setActiveCandidateId(nextContour.id);
          setDetectedCandidates((prev) => {
            const exists = prev.some((p) => p.id === nextContour.id);
            if (exists) return prev.map((p) => (p.id === nextContour.id ? nextContour : p));
            return prev.length ? [prev[0], nextContour, ...prev.slice(1)].slice(0, 6) : [nextContour];
          });
        }
      } else {
        // Branch 2: Tapping outside current selection (e.g. outer wheel rim while center bearing is active, or another part)
        const matchingOtherCand = [...detectedCandidates]
          .filter((c) => {
            if (c.id === activeCandidateId) return false;
            const inRect =
              normX >= c.region.x &&
              normX <= c.region.x + c.region.width &&
              normY >= c.region.y &&
              normY <= c.region.y + c.region.height;
            if (!inRect) return false;
            return c.polygon.length >= 6 ? isPointInsidePolygon(normX, normY, c.polygon) : true;
          })
          .sort((a, b) => {
            // If current selection is an inner sub-part, prefer restoring the enclosing whole assembly;
            // otherwise prefer the tightest distinct part under the cursor.
            const aArea = a.region.width * a.region.height;
            const bArea = b.region.width * b.region.height;
            return activeArea < 0.35 ? bArea - aArea : aArea - bArea;
          })[0];

        if (matchingOtherCand) {
          userInteractedRef.current = true;
          seq = ++pipelineSequenceRef.current;
          setTapRipple({ x: normX * 100, y: normY * 100, key: Date.now() });
          nextContour = matchingOtherCand;
          setActiveCandidateId(matchingOtherCand.id);
        } else {
          const seqBefore = pipelineSequenceRef.current;
          setIsTracingContour(true);
          const segmented = await segmentPartAtTapPoint(activeSrc, normX, normY, 0);
          if (seqBefore !== pipelineSequenceRef.current) return;
          setIsTracingContour(false);

          // Clicked empty background without a real physical part: keep default/current cutout intact!
          if (!segmented) {
            return;
          }

          userInteractedRef.current = true;
          seq = ++pipelineSequenceRef.current;
          setTapRipple({ x: normX * 100, y: normY * 100, key: Date.now() });

          const matchedExisting = detectedCandidates.find(
            (p) =>
              p.id === segmented.id ||
              (Math.hypot(p.center.x - segmented.center.x, p.center.y - segmented.center.y) < 0.06 &&
                Math.max(p.region.width * p.region.height, segmented.region.width * segmented.region.height) /
                  Math.max(1e-5, Math.min(p.region.width * p.region.height, segmented.region.width * segmented.region.height)) <
                  2.1),
          );

          nextContour = matchedExisting
            ? {
                ...segmented,
                id: matchedExisting.id,
                label: matchedExisting.label || segmented.label,
                partFamily: matchedExisting.partFamily || segmented.partFamily,
              }
            : segmented;

          setActiveCandidateId(nextContour.id);
          setDetectedCandidates((prev) => {
            const hasMatch = prev.some((p) => p.id === nextContour.id);
            if (hasMatch) {
              return prev.map((p) => (p.id === nextContour.id ? nextContour : p));
            }
            return prev.length ? [prev[0], nextContour, ...prev.slice(1)].slice(0, 6) : [nextContour];
          });
        }
      }
    }

    const isSameSelectionReady =
      nextContour.id === activeCandidateId &&
      Boolean(analysisResult) &&
      !errorMessage &&
      !isMatching &&
      Math.abs(nextContour.region.x - queryRegion.x) < 0.005 &&
      Math.abs(nextContour.region.width - queryRegion.width) < 0.005;

    setQueryRegion(nextContour.region);
    setActivePolygon(nextContour.polygon);
    triggerEdgeLockAnimation();

    if (isSameSelectionReady) {
      return;
    }

    const nextHint =
      nextContour.label ||
      (detectedCandidates.length > 1 && nextContour.id !== detectedCandidates[0]?.id ? '' : selectedSampleHint);

    await runRegionVisualMatch({
      imageSrc: cutoutBaseSrc,
      region: nextContour.region,
      polygon: nextContour.polygon,
      alphaData: nextContour.fromAiMask ? aiAlphaDataRef.current : null,
      seq,
      displayUrl: selectedImage || cutoutBaseSrc,
      sampleHint: nextHint,
      originalName: '',
    });
  };

  const handlePhotoSurfaceClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = lensBoxRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const normX = Math.max(0.02, Math.min(0.98, (e.clientX - box.left) / box.width));
    const normY = Math.max(0.02, Math.min(0.98, (e.clientY - box.top) / box.height));
    void handleImagePointSelect(normX, normY);
  };

  const handleFile = (file: File) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const fileMime = (file.type || '').toLowerCase();
    const okExt = /\.(?:jpe?g|png|webp)$/i.test(file.name);
    if ((fileMime ? !allowed.includes(fileMime) : !okExt) || file.size > 10 * 1024 * 1024) {
      setErrorMessage('لطفاً تصویر JPG، PNG یا WebP با حجم حداکثر ۱۰ مگابایت انتخاب کنید.');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    void launchDirectVisualResults(objectUrl, file, {
      originalName: file.name,
      sampleHint: file.name,
      mime: file.type || 'image/jpeg',
    });
  };

  const handleRecentClick = (item: VisionRecentSearchItem) => {
    void launchDirectVisualResults(item.imageUrl, item.imageUrl, {
      originalName: item.code || item.id,
      sampleHint: `${item.title} ${item.partHint || ''} ${item.code || ''}`.trim(),
      mime: 'image/png',
    });
  };

  // Camera actions
  const startCamera = async (facing: 'environment' | 'user' = cameraFacing) => {
    const req = ++cameraRequestRef.current;
    setScreen('camera');
    setIsCameraReady(false);
    setCameraNotice('');
    setErrorMessage('');
    setCameraZoom(1);
    cameraZoomRef.current = 1;

    try {
      const seen = window.localStorage.getItem(CAMERA_TIPS_SEEN_KEY);
      if (!seen) setCameraGuideOpen(true);
    } catch {
      setCameraGuideOpen(true);
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('دوربین زنده در این مرورگر فعال نیست.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (req !== cameraRequestRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      cameraStreamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const cap = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number } })
        | undefined;
      setCanUseTorch(Boolean(facing === 'environment' && cap?.torch));
      hwZoomRangeRef.current =
        cap?.zoom && typeof cap.zoom.min === 'number' && typeof cap.zoom.max === 'number'
          ? { min: cap.zoom.min, max: cap.zoom.max }
          : null;
      setTorchEnabled(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setIsCameraReady(false);
      setCameraNotice('دوربین متصل نیست؛ می‌توانید عکس گالری را باز کنید یا میز نور آزمایشی را ثبت نمایید.');
    }
  };

  const switchCamera = () => {
    const next = cameraFacing === 'environment' ? 'user' : 'environment';
    stopCameraStream();
    setCameraFacing(next);
    void startCamera(next);
  };

  const toggleTorch = async () => {
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (!canUseTorch || !track) return;
    try {
      const nextTorch = !torchEnabled;
      await track.applyConstraints({
        advanced: [{ torch: nextTorch } as MediaTrackConstraintSet & { torch: boolean }],
      });
      setTorchEnabled(nextTorch);
    } catch {
      setCanUseTorch(false);
    }
  };

  const captureCameraFrame = () => {
    if (videoRef.current && canvasRef.current && isCameraReady && videoRef.current.videoWidth) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      const digitalZoom = hwZoomRangeRef.current ? 1 : cameraZoomRef.current;
      const cropW = Math.round(vw / digitalZoom);
      const cropH = Math.round(vh / digitalZoom);
      const sx = Math.round((vw - cropW) / 2);
      const sy = Math.round((vh - cropH) / 2);

      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        void launchDirectVisualResults(dataUrl, dataUrl, {
          originalName: 'camera-capture.jpg',
          sampleHint: '',
          mime: 'image/jpeg',
        });
        return;
      }
    }
    // Live multi-part optical inspection bench fallback when sandbox lacks webcam hardware
    void launchDirectVisualResults(OPTICAL_BENCH_ART, OPTICAL_BENCH_ART, {
      originalName: 'optical-inspection.jpg',
      sampleHint: '',
      mime: 'image/jpeg',
    });
  };

  const handleCloseAction = () => {
    stopCameraStream();
    pipelineSequenceRef.current++;
    analyzeAbortRef.current?.abort();
    analyzeAbortRef.current = null;
    detectAbortRef.current?.abort();
    detectAbortRef.current = null;
    if (standalone) {
      navigate('/');
    } else {
      onClose();
    }
  };

  const openCustomManufacturingRequest = async () => {
    if (isPreparingCustomRequest || !selectedImage) return;
    const reqSeq = ++customRequestSequenceRef.current;
    setIsPreparingCustomRequest(true);
    setErrorMessage('');
    try {
      let imageBlob: Blob | null = null;
      let originalName = selectedOriginalName || 'forza-part-image';
      if (localImageId) {
        const localRec = await getCustomerDeviceImage(localImageId).catch(() => null);
        if (reqSeq !== customRequestSequenceRef.current || !isOpen) return;
        if (localRec) {
          imageBlob = localRec.blob;
          originalName = localRec.originalName || originalName;
        }
      }
      if (!imageBlob) {
        const res = await fetch(croppedPreviewUrl || temporaryImageDataUrl || selectedImage);
        if (!res.ok) throw new Error('خواندن تصویر انجام نشد.');
        imageBlob = await res.blob();
      }
      if (reqSeq !== customRequestSequenceRef.current || !isOpen) return;
      const file = await createManufacturingImageFile(imageBlob, originalName);
      if (reqSeq !== customRequestSequenceRef.current || !isOpen) return;
      const summary = analysisResult?.summary;
      const detectedName = [summary?.partFamilyFarsi, summary?.detectedPartType]
        .map((v) => String(v || '').trim())
        .find((v) => v.length > 1 && !/قطعه نامشخص|نامشخص/i.test(v));
      const observedDims = (summary?.observedSpecifications || [])
        .filter((s) => String(s.value || '').trim())
        .map((s) => `${s.name || 'مشخصه'}: ${String(s.value).trim()}`)
        .join('، ')
        .slice(0, 480);

      setCustomRequestDraft({
        file,
        partName: detectedName || 'قطعه صنعتی برای بررسی و ساخت سفارشی',
        partType: 'سایر قطعات مکانیکی خاص',
        dimensions: observedDims,
        alloyCondition: String(summary?.material || ''),
        notes: [
          'درخواست ساخت و مهندسی معکوس از جستجوی تصویری FORZA ثبت شده است.',
          summary?.visualAnalysis ? 'تشخیص بصری: ' + summary.visualAnalysis : '',
          analysisResult?.technicalAdvice ? 'توصیه مهندسی: ' + analysisResult.technicalAdvice : '',
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 2800),
      });
      setCustomRequestOpen(true);
    } catch (error: any) {
      setErrorMessage(error?.message || 'آماده‌سازی تصویر برای ثبت سفارش ساخت انجام نشد.');
    } finally {
      if (reqSeq === customRequestSequenceRef.current) setIsPreparingCustomRequest(false);
    }
  };

  // UNIFIED Catalog Product Grid (NEVER splits exact matches vs similar)
  const unifiedProducts = analysisResult
    ? [
        ...(analysisResult.matchedProducts || []),
        ...(analysisResult.similarCandidates || []),
      ].filter((item, idx, self) => idx === self.findIndex((t) => t.code === item.code))
    : [];

  const displayedRecentSearches = showAllHistory ? recentSearches : recentSearches.slice(0, 6);

  const navigateConsult = (code: string, name: string, brand: string, isSimilar: boolean) => {
    if (imageEventId) {
      void selectCustomerImageProduct(imageEventId, code).catch(() => undefined);
    }
    const q = buildVisionConsultationPrompt({ code, name, brand, isSimilar }, analysisResult?.summary);
    const params = new URLSearchParams({
      productCode: code,
      productName: name,
      ...(q ? { q } : {}),
    });
    onClose();
    navigate('/ai-consult?' + params.toString());
  };

  const shellPositionClass = standalone
    ? 'fv-workbench'
    : 'fv-workbench fixed inset-0 z-[110] overflow-y-auto';

  const digitalPreviewZoom = hwZoomRangeRef.current ? 1 : cameraZoom;

  const renderUnifiedProductCard = (item: (typeof unifiedProducts)[number]) => {
    const product = item.catalogProduct;
    const resolvedPrice =
      product && product.prices
        ? pricingCreditService.calculateInquiryPrice(
            product,
            currentUser?.assignedPriceListId || undefined,
          )?.calculatedPrice ||
          product.prices.retail ||
          0
        : 0;

    return (
      <article
        key={item.code}
        className="group flex flex-col bg-white transition-transform duration-150"
      >
        {/* Pure frameless white image stage — zero scan button, zero borders */}
        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-50">
          <CatalogResultImage
            sources={[item.image, product?.image]}
            alt={item.name}
            familyReference={false}
            hideZoomPill
            cleanSurface
            className="h-full w-full"
          />
        </div>

        <div className="flex flex-1 flex-col gap-1 pt-2.5 px-1">
          <h4 className="line-clamp-2 text-[13px] font-bold leading-snug text-slate-900">
            {item.name}
          </h4>

          <div className="mt-1 flex items-center justify-between gap-2">
            {resolvedPrice > 0 ? (
              <span className="text-[13px] font-extrabold text-slate-900 tabular-nums">
                {formatPrice(resolvedPrice)}
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-emerald-700">موجود در کاتالوگ</span>
            )}
          </div>

          <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
            <span className="truncate">
              {item.brand} · <span className="font-mono text-slate-600">{item.code}</span>
            </span>

            {product ? (
              <Link
                to={`/product/${product.code}`}
                onClick={() => onClose()}
                className="shrink-0 font-bold text-[#E06518] hover:text-[#c8550f] transition-colors whitespace-nowrap"
              >
                مشاهده
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => navigateConsult(item.code, item.name, item.brand, true)}
                className="shrink-0 font-bold text-[#E06518] hover:text-[#c8550f] transition-colors whitespace-nowrap cursor-pointer"
              >
                مشاوره
              </button>
            )}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div
      className={shellPositionClass}
      dir="rtl"
      role={standalone ? 'main' : 'dialog'}
      aria-modal={standalone ? undefined : 'true'}
      aria-label="جستجوی تصویری قطعات صنعتی FORZA VISION"
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label="انتخاب تصویر قطعه از دستگاه"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) handleFile(f);
          e.currentTarget.value = '';
        }}
      />

      {/* ==================================================================== */}
      {/* SCREEN: PINCH-LOCKED FULLSCREEN CAMERA + FIRST-TIME TIPS GUIDE       */}
      {/* ==================================================================== */}
      {screen === 'camera' && (
        <section
          className="fixed inset-0 z-[120] flex flex-col bg-[#080B10] text-white touch-none"
          data-testid="full-screen-camera-experience"
          aria-label="دوربین هوشمند شناسایی قطعه"
        >
          <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-[#0E1117] px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => {
                stopCameraStream();
                setScreen(selectedImage ? 'results' : 'entry');
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-semibold text-slate-100 hover:bg-white/10 whitespace-nowrap cursor-pointer"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
              <span>بازگشت</span>
            </button>

            <span className="text-sm font-bold text-white whitespace-nowrap tabular-nums">
              عکاسی از قطعه · {toPersianDigits(cameraZoom)}×
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCameraGuideOpen((v) => !v)}
                aria-label="راهنمای عکاسی"
                aria-expanded={cameraGuideOpen}
                className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors cursor-pointer ${
                  cameraGuideOpen
                    ? 'border-[#E06518] bg-[#E06518] text-white'
                    : 'border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'
                }`}
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void toggleTorch()}
                disabled={!canUseTorch}
                aria-label="فلش دوربین"
                aria-pressed={torchEnabled}
                className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors cursor-pointer disabled:opacity-35 ${
                  torchEnabled
                    ? 'border-[#E06518] bg-[#E06518] text-white'
                    : 'border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'
                }`}
              >
                <Zap className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleCloseAction}
                aria-label="بستن"
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* Camera-only pinch zoom stage */}
          <div
            ref={cameraStageRef}
            className="fv-camera-stage relative flex-1 flex items-center justify-center overflow-hidden bg-black p-4 sm:p-8"
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onCanPlay={() => setIsCameraReady(true)}
              style={{
                transform: `scale(${digitalPreviewZoom})`,
                transformOrigin: 'center center',
              }}
              className={`h-full w-full max-w-4xl rounded-2xl object-cover transition-transform duration-75 ${
                isCameraReady ? 'opacity-100' : 'hidden'
              }`}
            />

            {!isCameraReady && (
              <div className="relative h-full w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#12161E]">
                <img
                  src={OPTICAL_BENCH_ART}
                  alt="نمای آماده ثبت تصویر قطعه"
                  style={{
                    transform: `scale(${digitalPreviewZoom})`,
                    transformOrigin: 'center center',
                  }}
                  className="h-full w-full object-cover opacity-85 transition-transform duration-75"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/35" />
                {cameraNotice && (
                  <p className="absolute top-4 left-4 right-4 mx-auto max-w-lg rounded-xl border border-white/15 bg-black/75 px-4 py-2.5 text-center text-xs font-medium text-slate-100 backdrop-blur">
                    {cameraNotice}
                  </p>
                )}
              </div>
            )}

            {/* Reticle frame + persistent belt photography tip */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-8">
              <div className="mb-4 max-w-sm rounded-full border border-white/20 bg-black/70 px-4 py-1.5 text-center text-[11px] font-semibold text-amber-200 backdrop-blur">
                برای تسمه‌ها: مستقیم روبه‌روی برند و اطلاعات درج‌شده روی تسمه عکس بگیرید و بفرستید
              </div>
              <div className="fv-corner-brackets h-[min(64vw,300px)] w-[min(64vw,300px)] rounded-2xl" />
            </div>

            {/* First-time camera photography guide overlay */}
            {cameraGuideOpen && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
                role="dialog"
                aria-label="نکات عکاسی دقیق از قطعه"
              >
                <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#161A22] p-5 text-white shadow-2xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-[#FF8C42]">راهنمای عکاسی بهتر</span>
                      <h3 className="mt-1 text-base font-extrabold">
                        نکات کلیدی برای تشخیص دقیق‌تر قطعه
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={dismissCameraGuide}
                      aria-label="بستن راهنما"
                      className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-slate-200 hover:bg-white/20 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    <div className="flex items-start gap-3 rounded-xl border border-[#E06518]/45 bg-[#E06518]/10 p-3">
                      <Focus className="mt-0.5 h-4 w-4 shrink-0 text-[#FF8C42]" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-bold text-white">برای تسمه‌ها: مستقیم روبه‌روی برند و اطلاعات</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-200">
                          برای تسمه‌ها، دوربین را مستقیم روبه‌روی برند و اطلاعات درج‌شده روی تسمه بگیرید و بفرستید تا کد و گام تسمه کاملاً خوانده شود.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                      <Sun className="mt-0.5 h-4 w-4 shrink-0 text-[#FF8C42]" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-bold text-white">نور یکنواخت و زاویه روبرو</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                          دوربین را مستقیم بالای قطعه نگه دارید تا فرم دایره‌ها، شیارها و دندانه‌ها کامل دیده شود و انعکاس شدید فلز جزئیات را محو نکند.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                      <ZoomIn className="mt-0.5 h-4 w-4 shrink-0 text-[#FF8C42]" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-bold text-white">زوم دوربین با دو انگشت</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                          برای بزرگ‌نمایی قطعات یا نوشته‌های ریز، دو انگشت را روی کادر دوربین باز و بسته کنید.
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={dismissCameraGuide}
                    className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#E06518] text-sm font-bold text-white hover:bg-[#c8550f] cursor-pointer"
                  >
                    متوجه شدم، آماده عکاسی‌ام
                  </button>
                </div>
              </div>
            )}

            {/* Zoom preset controls inside camera */}
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/75 px-2 py-1 backdrop-blur">
              {CAMERA_ZOOM_PRESETS.map((z) => {
                const active = Math.abs(cameraZoom - z) < 0.22;
                return (
                  <button
                    key={z}
                    type="button"
                    onClick={() => applyCameraZoom(z)}
                    className={`rounded-full px-3 py-1 text-xs font-bold tabular-nums transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#E06518] text-white'
                        : 'text-slate-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {toPersianDigits(z)}×
                  </button>
                );
              })}
            </div>
          </div>

          <footer className="border-t border-white/10 bg-[#0E1117] px-4 py-4">
            <div className="mx-auto flex max-w-md items-center justify-between gap-6">
              <button
                type="button"
                onClick={() => cameraGalleryRef.current?.click()}
                aria-label="انتخاب عکس از گالری"
                className="flex flex-col items-center gap-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/15 bg-white/5">
                  <GalleryImage className="h-5 w-5" />
                </span>
                <span>گالری</span>
              </button>

              <button
                type="button"
                onClick={captureCameraFrame}
                aria-label="ثبت تصویر قطعه"
                className="group relative grid h-[74px] w-[74px] place-items-center rounded-full border-[3px] border-white p-1.5 transition-transform active:scale-95 cursor-pointer"
              >
                <span className="h-full w-full rounded-full bg-[#E06518] transition-colors group-hover:bg-[#f07428]" />
              </button>

              <button
                type="button"
                onClick={switchCamera}
                aria-label="تغییر دوربین"
                className="flex flex-col items-center gap-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/15 bg-white/5">
                  <SwitchCamera className="h-5 w-5" />
                </span>
                <span>چرخش</span>
              </button>
            </div>
            <input
              ref={cameraGalleryRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) handleFile(f);
                e.currentTarget.value = '';
              }}
            />
          </footer>
          <canvas ref={canvasRef} className="sr-only" />
        </section>
      )}

      {/* ==================================================================== */}
      {/* SCREEN: DIRECT ENTRY -> TOROB MOBILE SHEET + CLEAN WHITE CARDS       */}
      {/* ==================================================================== */}
      {screen === 'results' && selectedImage && (
        <section
          className="flex min-h-[100dvh] lg:h-[100dvh] flex-col bg-white text-slate-900 lg:overflow-hidden"
          aria-label="لنز هوشمند و محصولات مشابه"
        >
          <div className="flex-1 lg:grid lg:grid-cols-12 lg:h-full lg:overflow-hidden">
            {/* -------------------------------------------------------------- */}
            {/* PHOTO & CONTOUR CANVAS (Pure White Stage / Mobile Top Split)   */}
            {/* -------------------------------------------------------------- */}
            <div className="relative flex flex-col bg-white lg:col-span-5 lg:h-full lg:border-l lg:border-slate-100">
              {/* Floating Action Bar Overlaid on Top of Photo (Torob Mobile Style) */}
              <div className="pointer-events-none absolute top-0 left-0 right-0 z-30 flex items-center justify-between gap-3 px-4 pt-4">
                <button
                  type="button"
                  onClick={handleCloseAction}
                  aria-label="بستن جستجوی تصویری"
                  className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-slate-900/75 text-white shadow-sm backdrop-blur-md transition-colors hover:bg-slate-900 cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>

                <div className="pointer-events-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      stopCameraStream();
                      setScreen('entry');
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-900/75 px-4 text-xs font-bold text-white shadow-sm backdrop-blur-md transition-colors hover:bg-slate-900 whitespace-nowrap cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>عکس جدید</span>
                  </button>
                </div>
              </div>

              {/* Interactive Optical Spotlight Canvas — Torob-matched Original Photo + Tight Cutout */}
              <div className="relative flex h-[40dvh] min-h-[250px] max-h-[360px] lg:h-full lg:max-h-none items-center justify-center bg-[#F8FAFC] px-3 pt-14 pb-8 lg:p-6">
                <div
                  ref={lensBoxRef}
                  onClick={handlePhotoSurfaceClick}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleImagePointSelect(0.5, 0.5);
                  }}
                  aria-label="برای انتخاب هر قطعه در تصویر روی آن ضربه بزنید"
                  className="relative inline-block max-w-full max-h-full overflow-hidden rounded-2xl bg-white shadow-sm cursor-crosshair select-none"
                >
                  <img
                    src={selectedImage}
                    alt="تصویر قطعه ارسالی"
                    className="block max-h-[30dvh] sm:max-h-[34dvh] lg:max-h-[76dvh] max-w-full w-auto h-auto object-contain select-none"
                  />

                  {/* Clean Rounded L-Corner Crop Frame & Dimmed Outside Mask */}
                  <div
                    aria-hidden="true"
                    style={{
                      left: `${queryRegion.x * 100}%`,
                      top: `${queryRegion.y * 100}%`,
                      width: `${queryRegion.width * 100}%`,
                      height: `${queryRegion.height * 100}%`,
                    }}
                    className={`fv-lens-bracket fv-lens-bracket--box-mask ${edgeLockFlash ? 'fv-lens-bracket--locking' : ''}`}
                  >
                    <span className="fv-lens-corner fv-lens-corner--tl" />
                    <span className="fv-lens-corner fv-lens-corner--tr" />
                    <span className="fv-lens-corner fv-lens-corner--bl" />
                    <span className="fv-lens-corner fv-lens-corner--br" />
                  </div>

                  {/* Single Active Center Blue Indicator Dot (zero white dots cluttering the part) */}
                  {(() => {
                    const activeCand = detectedCandidates.find((c) => c.id === activeCandidateId);
                    const dotCenter = activeCand
                      ? activeCand.center
                      : {
                          x: queryRegion.x + queryRegion.width / 2,
                          y: queryRegion.y + queryRegion.height / 2,
                        };
                    return (
                      <span
                        aria-hidden="true"
                        style={{
                          left: `${dotCenter.x * 100}%`,
                          top: `${dotCenter.y * 100}%`,
                        }}
                        className="fv-object-dot fv-object-dot--active pointer-events-none z-20"
                      />
                    );
                  })()}

                  {/* Tactile ripple feedback at tap point */}
                  {tapRipple && (
                    <span
                      key={tapRipple.key}
                      className="fv-tap-ripple pointer-events-none absolute z-30"
                      style={{ left: `${tapRipple.x}%`, top: `${tapRipple.y}%` }}
                    />
                  )}
                </div>

                {/* Subtle status indicator tucked cleanly at bottom of photo area while processing */}
                {(isDetectingParts || isAiSegmenting || isTracingContour) && (
                  <div className="pointer-events-none absolute bottom-7 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap rounded-full bg-slate-900/75 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-md">
                    {isAiSegmenting
                      ? 'در حال تشخیص و برش هوشمند قطعه...'
                      : isDetectingParts
                      ? 'در حال تشخیص خودکار قطعه...'
                      : 'در حال ردیابی لبه دقیق قطعه...'}
                  </div>
                )}
              </div>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* UNIFIED SIMILAR PRODUCTS PANEL (Torob White Sheet / Left Split)*/}
            {/* -------------------------------------------------------------- */}
            <div
              ref={mobileResultsAnchorRef}
              className={`relative flex flex-col bg-white text-slate-900 lg:col-span-7 lg:h-full lg:overflow-y-auto transition-all ${
                mobileSheetExpanded
                  ? 'fixed inset-0 z-40 rounded-none mt-0 overflow-y-auto'
                  : 'z-20 -mt-5 rounded-t-[26px] shadow-[0_-10px_28px_rgba(15,23,42,0.08)] lg:mt-0 lg:rounded-none lg:shadow-none'
              }`}
            >
              {/* Mobile Sheet Pull Handle */}
              <div className="flex justify-center pt-2.5 pb-1 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileSheetExpanded((v) => !v)}
                  aria-label="تغییر ارتفاع لیست نتایج"
                  className="h-1 w-10 rounded-full bg-slate-300 cursor-pointer"
                />
              </div>

              {/* Header Row: Cropped Part Thumb + محصولات مشابه + Working "همه نتایج" Button */}
              <div className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200/90 bg-white p-1 shadow-2xs">
                      <img
                        src={croppedPreviewUrl || selectedImage}
                        alt="برش قطعه انتخاب‌شده"
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-extrabold text-slate-900 sm:text-lg">
                        محصولات مشابه
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-500 tabular-nums truncate">
                        {isMatching
                          ? 'در حال تطبیق با کاتالوگ...'
                          : `${toPersianDigits(unifiedProducts.length)} محصول مشابه${
                              analysisResult?.summary?.partFamilyFarsi
                                ? ` · ${analysisResult.summary.partFamilyFarsi}`
                                : ''
                            }`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setMobileSheetExpanded((v) => {
                          const next = !v;
                          if (!next) {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }
                          return next;
                        });
                      }}
                      className="inline-flex h-9 items-center gap-1 rounded-full bg-slate-900 px-4 text-xs font-extrabold text-white shadow-sm transition-colors hover:bg-[#E06518] whitespace-nowrap cursor-pointer"
                    >
                      <span>{mobileSheetExpanded ? 'مشاهده تصویر' : 'همه نتایج'}</span>
                      {mobileSheetExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                {isMatching && <div className="fv-indeterminate-bar mt-2.5 rounded-full" />}
              </div>

              {errorMessage && (
                <div className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 sm:mx-6">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* UNIFIED 2-col Mobile / 3-col Desktop Product Grid — Pure White Background */}
              <div className="flex-1 p-4 sm:p-6">
                {unifiedProducts.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-3.5 sm:gap-5 xl:grid-cols-3">
                      {(mobileSheetExpanded ? unifiedProducts : unifiedProducts.slice(0, 12)).map(
                        renderUnifiedProductCard,
                      )}
                    </div>

                    {analysisResult?.summary?.partFamilyFarsi && (
                      <div className="mt-6 flex justify-center">
                        <Link
                          to={`/products?search=${encodeURIComponent(analysisResult.summary.partFamilyFarsi)}`}
                          onClick={() => onClose()}
                          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-100 px-5 text-xs font-bold text-slate-800 transition-colors hover:bg-[#E06518] hover:text-white whitespace-nowrap"
                        >
                          <span>مشاهده همه کالاهای مرتبط در کاتالوگ</span>
                          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    )}
                  </>
                ) : analysisResult?.modelSuggestions?.length ? (
                  <LocalModelResults
                    items={analysisResult.modelSuggestions}
                    onClose={() => onClose()}
                  />
                ) : isMatching ? (
                  <div className="grid grid-cols-2 gap-3.5 sm:gap-5 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="animate-pulse overflow-hidden">
                        <div className="aspect-square w-full rounded-xl bg-slate-100" />
                        <div className="mt-3 h-3 w-3/4 rounded bg-slate-100" />
                        <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-slate-50 p-8 text-center">
                    <p className="text-sm font-bold text-slate-900">
                      محصول مشابهی در کاتالوگ پیدا نشد
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      روی بخش دیگری از تصویر کلیک کنید یا درخواست ساخت سفارشی ثبت کنید.
                    </p>
                  </div>
                )}

                {/* Concise Custom Manufacturing / Direct Engineering Support Row (Light Surface) */}
                <div className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
                  <div className="text-xs">
                    <p className="font-bold text-slate-900">
                      قطعه مورد نظر در نتایج نبود؟ مهندسی معکوس و ساخت سفارشی فورزا
                    </p>
                    <p className="mt-0.5 text-slate-500">
                      ارسال همین تصویر برای طراحی سه‌بعدی و تولید دقیق توسط تیم مهندسی
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openCustomManufacturingRequest()}
                      disabled={isPreparingCustomRequest}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#E06518] px-3.5 text-xs font-bold text-white hover:bg-[#c8550f] whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>ثبت سفارش ساخت</span>
                    </button>
                    <a
                      href="tel:02166700000"
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-100 whitespace-nowrap"
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>تماس</span>
                    </a>
                    <a
                      href="https://wa.me/989120000000"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
                    >
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>واتساپ</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ==================================================================== */}
      {/* SCREEN: CLEAN WHITE INITIAL ENTRY PORTAL (RESPONSIVE DESKTOP+MOBILE) */}
      {/* ==================================================================== */}
      {screen === 'entry' && (
        <div className="flex min-h-[100dvh] flex-col bg-white text-slate-900">
          {/* Clean 2-Zone Light Header */}
          <header className="border-b border-slate-100 bg-white">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#E06518] text-white">
                  <ScanSearch className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <span className="block text-sm font-black tracking-tight text-slate-900 whitespace-nowrap">
                    FORZA VISION
                  </span>
                  <p className="text-[11px] text-slate-500 whitespace-nowrap">
                    جستجوی تصویری و تشخیص هوشمند قطعات صنعتی
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseAction}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-100 px-4 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 whitespace-nowrap cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span>{standalone ? 'بازگشت به سایت' : 'بستن'}</span>
              </button>
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-6 sm:px-6 lg:py-10">
            {errorMessage && (
              <div className="mb-5 flex items-center gap-2 rounded-2xl bg-red-50 p-3.5 text-xs font-bold text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Balanced 12-Col Responsive Split Studio on Clean White */}
            <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12 lg:gap-8">
              {/* Right Column: Interactive Upload & Camera Capture Workspace */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFile(f);
                }}
                className={`flex flex-col justify-between rounded-3xl p-6 sm:p-8 lg:col-span-7 transition-colors ${
                  isDragOver ? 'bg-orange-50' : 'bg-[#F6F8FA]'
                }`}
              >
                <div>
                  <h1 className="text-2xl font-black leading-snug text-slate-900 sm:text-3xl lg:text-4xl">
                    قطعه را با یک عکس بشناسید و نمونه مشابه را پیدا کنید
                  </h1>
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">
                    تصویر را اینجا رها کنید یا عکس بگیرید؛ قطعات همان لحظه به‌صورت خودکار شناسایی، نقطه‌گذاری و دورگیری می‌شوند.
                  </p>

                  {/* Two Tactile 48px+ Primary Actions */}
                  <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-[#E06518] px-7 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#c8550f] whitespace-nowrap cursor-pointer"
                    >
                      <Camera className="h-5 w-5" aria-hidden="true" />
                      <span>گرفتن عکس با دوربین</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex h-12 items-center justify-center gap-2.5 rounded-2xl bg-white px-7 text-sm font-bold text-slate-900 shadow-xs transition-colors hover:bg-slate-100 whitespace-nowrap cursor-pointer"
                    >
                      <GalleryImage className="h-5 w-5 text-[#E06518]" aria-hidden="true" />
                      <span>انتخاب تصویر از گالری</span>
                    </button>
                  </div>

                  <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                    <UploadCloud className="h-4 w-4 text-[#E06518]" aria-hidden="true" />
                    <span>پشتیبانی از JPG، PNG و WebP تا ۱۰ مگابایت · امکان کشیدن و رها کردن تصویر</span>
                  </p>
                </div>

                {/* Clean Hairline-Separated Guidance Points (Zero Pill Clutter, Prominent Belt Tip) */}
                <div className="mt-8 divide-y divide-slate-200/80 border-t border-slate-200/80 pt-3">
                  <div className="flex items-start gap-2.5 py-2.5">
                    <Focus className="mt-0.5 h-4 w-4 shrink-0 text-[#E06518]" aria-hidden="true" />
                    <span className="text-xs font-bold leading-relaxed text-slate-900">
                      برای تسمه‌ها: مستقیم روبه‌روی برند و اطلاعات درج‌شده روی تسمه عکس بگیرید و بفرستید
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5 py-2.5">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#E06518]" aria-hidden="true" />
                    <span className="text-xs leading-relaxed text-slate-600">
                      شناسایی خودکار قطعات در لحظه ارسال تصویر با دورگیری دقیق لبه‌های محصول
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5 py-2.5">
                    <Search className="mt-0.5 h-4 w-4 shrink-0 text-[#E06518]" aria-hidden="true" />
                    <span className="text-xs leading-relaxed text-slate-600">
                      کلیک روی هر بخش یا نقطه قطعه برای تغییر انتخاب و نمایش فوری محصولات مشابه
                    </span>
                  </div>
                </div>
              </div>

              {/* Left Column: Clean Photographic Showcase */}
              <div className="relative overflow-hidden rounded-3xl bg-slate-100 min-h-[220px] lg:col-span-5">
                <img
                  src="/images/company/ai-search-mobile.webp"
                  alt="جستجوی تصویری قطعات صنعتی فورزا"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/25 to-transparent" />
                <div className="absolute bottom-5 right-5 left-5 text-white">
                  <p className="text-sm font-extrabold sm:text-base">
                    تشخیص دقیق تسمه، بلبرینگ، پولی و قطعات صنعتی
                  </p>
                  <p className="mt-1 text-xs text-slate-200">
                    انتخاب هوشمند لبه قطعه و تطبیق فوری با موجودی انبار صنعت‌پیش
                  </p>
                </div>
              </div>
            </div>

            {/* Optional User Recent Scans History on Clean White/Soft-Tint Surface */}
            {recentSearches.length > 0 && (
              <section className="mt-8">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <History className="h-4 w-4 text-[#E06518]" aria-hidden="true" />
                    <span>جستجوهای تصویری اخیر شما</span>
                  </h3>
                  {recentSearches.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllHistory((v) => !v)}
                      className="text-xs font-bold text-[#E06518] hover:underline cursor-pointer"
                    >
                      {showAllHistory ? 'نمایش کمتر' : `همه (${toPersianDigits(recentSearches.length)})`}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                  {displayedRecentSearches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleRecentClick(item)}
                      className="flex items-center gap-3 rounded-2xl bg-[#F6F8FA] p-2.5 text-right transition-colors hover:bg-slate-100 cursor-pointer"
                    >
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white p-1">
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-slate-900">{item.title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">
                          {item.subtitle || item.timeLabel}
                        </p>
                      </div>
                      <ChevronLeft className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
      )}

      {/* Lazy Custom Manufacturing Modal */}
      {customRequestOpen && customRequestDraft && (
        <Suspense fallback={null}>
          <LazyCustomPartRequestModal
            isOpen={customRequestOpen}
            initialFile={customRequestDraft.file}
            initialPartName={customRequestDraft.partName}
            initialPartType={customRequestDraft.partType}
            initialDimensions={customRequestDraft.dimensions}
            initialAlloyCondition={customRequestDraft.alloyCondition}
            initialNotes={customRequestDraft.notes}
            onClose={() => setCustomRequestOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
};
