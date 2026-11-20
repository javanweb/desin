import {durableStorage} from "../services/durableStorage";
import {WorkspaceCatalog, type ConsultationCatalogProduct, type WorkspaceCatalogResult} from '../components/search/WorkspaceCatalog';
import {memberPath} from '../components/storefront/MemberAccess';
import {useAuth} from '../context/AuthContext';
import React, { lazy, Suspense, useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  X,
  Camera,
  Copy,
  Check,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Settings,
  Home,
  Send,
  Trash2,
  Share2,
  Factory,
  Upload,
  ShoppingCart,
  SwitchCamera,
  MessageSquare,
  Search,
  SlidersHorizontal,
  Loader2,
  Square,
  ArrowUpLeft,
} from 'lucide-react';
import { apiUrl } from '../config/apiConfig';
import { consumeForzaTextStream } from '../utils/forzaStreamClient';
import { buildVisionConsultationPrompt } from '../utils/visionConsultationPrompt';
import { CognivoGeometricLogo } from '../components/common/AiFloatingButton';
import {
  BeltIcon,
  PulleyIcon,
  BearingIcon,
  ChainCouplingIcon,
  KilnRollerIcon,
  MechanicalSealIcon,
  DinCalculatorIcon,
  VisualScannerIcon,
  LiveVoiceIcon,
  DeepEngineeringIcon,
  CatalogFinderIcon,
  SpecSheetIcon,
} from '../components/forza/ForzaWorkspaceIcons';
import {
  DinCalculatorModal,
  WorkspaceSettingsModal,
} from '../components/forza/ForzaWorkspaceModals';
import { WorkspaceMessageItem } from '../components/forza/ForzaWorkspaceMessage';
import {
  aiVisualSearchService,
  AiPartAnalysisResult,
  MatchedPartItem,
  INDUSTRIAL_PRESET_SAMPLES,
  IndustrialPresetSample,
} from '../services/aiVisualSearchService';
import { useCart } from '../context/CartContext';
import {
  saveCustomerDeviceImage,
  getCustomerDeviceImage,
  adoptCustomerDeviceImage,
  customerImageBlobToDataUrl,
  getCustomerDeviceImageMetadata,
} from '../services/customerImageVault';
import {
  createCustomerImageIdentification,
  completeCustomerImageIdentification,
  saveCustomerConsultation,
  selectCustomerImageProduct,
} from '../services/customerIntelligenceService';
const AiVisualPartSearchModal = lazy(() => import('../components/search/AiVisualPartSearchModal').then(m=>({default:m.AiVisualPartSearchModal})));

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  time: string;
  suggestedAction?: {
    label: string;
    link?: string;
  };
}

interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  messages: Message[];
}

type ConsultationProduct = ConsultationCatalogProduct;

const STORAGE_KEY = 'forza_industrial_chat_sessions_v2';
const ACTIVE_SESSION_KEY = 'forza_active_session_id_v2';

interface PartCategoryOption {
  id: string;
  title: string;
  subtitle: string;
  defaultApplication: string;
  recommendedParams: string;
  icon: React.FC<{ className?: string; size?: number }>;
}

const PART_CATEGORIES: PartCategoryOption[] = [
  {
    id: 'belts',
    title: 'تسمه‌های انتقال قدرت و تایمینگ',
    subtitle: 'V-Belt، تایمینگ PU و کلروپرن، شیاردار، جوشی',
    defaultApplication: 'سیستم‌های انتقال قدرت الکتروموتور و شفت',
    recommendedParams: 'طول اسمی (Li/Lp)، عرض مقطع (mm)، گام دندانه',
    icon: BeltIcon,
  },
  {
    id: 'pulleys',
    title: 'پولی‌ها و چرخ‌تسمه‌های صنعتی',
    subtitle: 'تایمینگ دندانه‌دار، گوه، تیپرلاک FORZA، چدنی',
    defaultApplication: 'شفت الکتروموتور و گیربکس خطوط تولید',
    recommendedParams: 'قطر خارجی، تعداد دندانه یا شیار، قطر سوراخ شفت',
    icon: PulleyIcon,
  },
  {
    id: 'bearings',
    title: 'بلبرینگ‌ها و یاتاقان‌ها',
    subtitle: 'شیار عمیق، رولربیرینگ، یاتاقان بلبرینگ صنعتی',
    defaultApplication: 'محورها و شفت‌های دوار با دور بالا',
    recommendedParams: 'قطر داخلی (d)، قطر خارجی (D)، پهنا (B)',
    icon: BearingIcon,
  },
  {
    id: 'chains',
    title: 'زنجیرها، چرخ‌دنده‌ها و کوپلینگ‌ها',
    subtitle: 'زنجیر تک‌ردیفه و دوبل، دنده‌زنجیر، کوپلینگ رابر',
    defaultApplication: 'انتقال گشتاور و نوار نقاله‌های بار سنگین',
    recommendedParams: 'گام زنجیر (اینچ/میلیمتر)، تعداد دندانه، مدل کوپلینگ',
    icon: ChainCouplingIcon,
  },
  {
    id: 'kiln',
    title: 'قطعات خطوط کوره، کاشی و سرامیک',
    subtitle: 'رولیک نسوز، لاستیک کوره، تسمه‌های حرارتی',
    defaultApplication: 'کوره رولری پخت کاشی و خطوط لعاب‌کاری',
    recommendedParams: 'طول رولیک، قطر خارجی، دمای کارکرد (C°)',
    icon: KilnRollerIcon,
  },
  {
    id: 'other',
    title: 'سایر قطعات مکانیکی و ساختنی',
    subtitle: 'کاسه‌نمد، بوش‌های برنزی، واشرها و قطعات خاص',
    defaultApplication: 'آب‌بندی و نگهداری تخصصی تجهیزات کارخانه',
    recommendedParams: 'ابعاد سه‌گانه، متریال (NBR / فولاد / پلی‌یورتان)',
    icon: MechanicalSealIcon,
  },
];

const INDUSTRY_DOMAINS = [
  { id: 'general', label: 'عمومی و خطوط انتقال قدرت' },
  { id: 'ceramic', label: 'کاشی، سرامیک و کوره‌های رولری' },
  { id: 'textile', label: 'نساجی، ریسندگی و بافندگی' },
  { id: 'cement', label: 'سیمان، فولاد و معادن سنگین' },
  { id: 'food', label: 'صنایع غذایی و نوشیدنی' },
  { id: 'packaging', label: 'بسته‌بندی و کارتن‌سازی' },
  { id: 'machinery', label: 'ماشین‌سازی و تجهیزات صنعتی' },
  { id: 'rubber', label: 'لاستیک و پلاستیک' },
];

const PROMPT_SUGGESTIONS = [
  {
    title: 'محاسبه طول تسمه DIN 2215',
    desc: 'فرمول دقیق با فاصله مراکز و قطر پولی‌ها',
    query: 'محاسبه و طراحی فنی: فرمول دقیق محاسبه طول اسمی تسمه، فاصله محور شفت‌ها و نسبت تبدیل دور پولی',
    icon: DinCalculatorIcon,
  },
  {
    title: 'استعلام قطعات FORZA و SWR',
    desc: 'کد، ابعاد و اطلاعات ثبت‌شده محصولات',
    query: 'بررسی مشخصات فنی، موجودی انبار مرکزی و استعلام قیمت برندهای انحصاری SWR آلمان و FORZA ایتالیا',
    icon: CatalogFinderIcon,
  },
  {
    title: 'قطعات کوره کاشی و سرامیک',
    desc: 'رولیک‌های سرامیکی، پولی و تسمه‌های نسوز',
    query: 'شرایط نگهداری، طول عمر مفید و دمای کارکرد تسمه‌های صنعتی و رولیک‌های نسوز در کوره کاشی و سرامیک چیست؟',
    icon: KilnRollerIcon,
  },
  {
    title: 'تطبیق و استخراج مشخصات',
    desc: 'تبدیل لیست قطعات به کدهای استاندارد',
    query: 'خلاصه‌سازی و استخراج مشخصات فنی: لیست کدهای فنی تسمه، پولی و یاتاقان را با استانداردهای مربوطه مرتب کنید.',
    icon: SpecSheetIcon,
  },
];

export const AiConsultPage: React.FC<{ identificationOnly?: boolean }> = ({ identificationOnly = false }) => {
  const navigate = useNavigate();
  const {currentUser,openAuthModal}=useAuth();
  const [entryParams]=useSearchParams();
  const { addToCart } = useCart();

  React.useEffect(() => {
    if (!identificationOnly && entryParams.get('view') === 'visual') navigate('/identify-part?from=workspace&' + entryParams.toString(), { replace: true });
  }, [identificationOnly, entryParams, navigate]);

  // Mode: Engineering Chat OR Visual Part Identification Studio
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'chat' | 'visual_studio'>(()=>identificationOnly || entryParams.get('view')==='visual'?'visual_studio':'chat');

  // Chat sessions state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');

  // Chat Input & stream state
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackState, setFeedbackState] = useState<Record<string, 'up' | 'down'>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [showCalculatorModal, setShowCalculatorModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isDeeperResearchActive, setIsDeeperResearchActive] = useState(false);
  const [isVisualSearchModalOpen, setIsVisualSearchModalOpen] = useState(false);

  // Settings State
  const [selectedIndustry, setSelectedIndustry] = useState(()=>entryParams.get('industry')||'general');
  const [calculationStandard, setCalculationStandard] = useState<'din' | 'fast'>('din');

  // Visual Part Studio State
  const [selectedPartCategory, setSelectedPartCategory] = useState<string>('belts');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedImageId, setCapturedImageId] = useState<string | null>(null);
  const [isSavingCapturedImage, setIsSavingCapturedImage] = useState(false);
  const [imageEventId, setImageEventId] = useState<string | null>(null);
  const [selectedConsultProducts, setSelectedConsultProducts] = useState<ConsultationProduct[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Parameters
  const [dimensionLength, setDimensionLength] = useState<string>('');
  const [dimensionWidth, setDimensionWidth] = useState<string>('');
  const [dimensionPitch, setDimensionPitch] = useState<string>('');
  const [partApplication, setPartApplication] = useState<string>('');
  const [partMarking, setPartMarking] = useState<string>('');

  // Analysis result state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AiPartAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [addedCartCode, setAddedCartCode] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);

  // A conversation is its own request boundary. Responses from a previously
  // selected/deleted conversation must never update the visible chat or CRM.
  const cancelActiveConsultation = () => {
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = null;
    setLoading(false);
  };
  useEffect(() => () => {
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = null;
  }, []);

  // Belt Length Calculator State
  const [calcC, setCalcC] = useState<string>('500');
  const [calcD, setCalcD] = useState<string>('200');
  const [calcd, setCalcd] = useState<string>('100');
  const [calcResult, setCalcResult] = useState<{
    length: number;
    ratio: number;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const productContextAddedRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [inputQuery]);

  const addProductToConsultation = (product: ConsultationProduct) => {
    setSelectedConsultProducts(current => current.some(item => item.code === product.code)
      ? current
      : [...current, product].slice(0, 20));
    setActiveWorkspaceTab('chat');
  };

  useEffect(() => {
    const code = entryParams.get('productCode')?.trim();
    const name = entryParams.get('productName')?.trim();
    if (!code || productContextAddedRef.current === code) return;
    productContextAddedRef.current = code;
    const product = { code, name: name || code };
    setSelectedConsultProducts(current => current.some(item => item.code === code) ? current : [...current, product].slice(0, 20));
    setActiveWorkspaceTab('chat');
  }, [entryParams]);

  // Read the catalog's real reference image and SKU size when a product detail
  // page opens the desk. Images are display references, never proof of SKU identity.
  useEffect(() => {
    const code = entryParams.get('productCode')?.trim();
    if (!code) return;
    const controller = new AbortController();
    void fetch(apiUrl('/api/ai/catalog-search?q=' + encodeURIComponent(code)), {
      signal: controller.signal,
      credentials: 'same-origin',
    }).then(response => response.ok ? response.json() : null).then(payload => {
      if (controller.signal.aborted || !Array.isArray(payload?.results)) return;
      const family = payload.results.find((item: WorkspaceCatalogResult) =>
        item.code === code || item.variants?.some(variant => variant.code === code)
      ) as WorkspaceCatalogResult | undefined;
      if (!family) return;
      const variant = family.variants?.find(item => item.code === code);
      const image = typeof family.images?.[0] === 'string' ? family.images[0] : undefined;
      setSelectedConsultProducts(current => current.map(item => item.code === code
        ? { ...item, size: variant?.size || item.size, image, link: family.link }
        : item));
    }).catch(() => { /* Search results remain optional during a catalog outage. */ });
    return () => controller.abort();
  }, [entryParams]);

  // Load Sessions from LocalStorage
  useEffect(() => {
    const loadSessionsFromStorage = () => {
      try {
        const stored = durableStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed: ChatSession[] = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSessions(parsed);
            const savedActiveId = durableStorage.getItem(ACTIVE_SESSION_KEY);
            const matched = parsed.find(s => s.id === savedActiveId) || parsed[0];
            setActiveSessionId(matched.id);
            setMessages(matched.messages || []);
            return;
          }
        }
      } catch {}

      createNewSession(false);
    };

    loadSessionsFromStorage();

    const handleSync = () => {
      loadSessionsFromStorage();
    };

    window.addEventListener('storage', handleSync);
    window.addEventListener('forza_chat_updated', handleSync);

    return () => {
      window.removeEventListener('storage', handleSync);
      window.removeEventListener('forza_chat_updated', handleSync);
    };
  }, []);

  const saveSessionsToStorage = (updatedSessions: ChatSession[]) => {
    setSessions(updatedSessions);
    try {
      durableStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
    } catch {}
  };

  const createNewSession = (autoFocus = true, baseSessions: ChatSession[] = sessions) => {
    cancelActiveConsultation();
    const newId = 'session-' + Date.now();
    const newSession: ChatSession = {
      id: newId,
      title: 'گفتگوی جدید',
      timestamp: Date.now(),
      messages: [],
    };
    const updated = [newSession, ...baseSessions.filter(s => s.messages.length > 0)];
    saveSessionsToStorage(updated);
    setActiveSessionId(newId);
    try {
      durableStorage.setItem(ACTIVE_SESSION_KEY, newId);
    } catch {}
    setMessages([]);
    setInputQuery('');
    setActiveWorkspaceTab(identificationOnly || (!autoFocus && entryParams.get('view') === 'visual') ? 'visual_studio' : 'chat');
    setIsMobileDrawerOpen(false);
    if (autoFocus) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const switchSession = (sessionId: string) => {
    const target = sessions.find(s => s.id === sessionId);
    if (target) {
      cancelActiveConsultation();
      setActiveSessionId(target.id);
      try {
        durableStorage.setItem(ACTIVE_SESSION_KEY, target.id);
      } catch {}
      setMessages(target.messages || []);
      setActiveWorkspaceTab('chat');
      setIsMobileDrawerOpen(false);
      setTimeout(scrollToBottom, 50);
    }
  };

  const deleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = sessions.filter(s => s.id !== sessionId);
    saveSessionsToStorage(updated);
    if (activeSessionId === sessionId) {
      if (updated.length > 0) {
        switchSession(updated[0].id);
      } else {
        createNewSession(false, updated);
      }
    }
  };

  const clearAllHistory = () => {
    cancelActiveConsultation();
    durableStorage.removeItem(STORAGE_KEY);
    durableStorage.removeItem(ACTIVE_SESSION_KEY);
    setSessions([]);
    createNewSession(false, []);
    setSelectedConsultProducts([]);
    setShowSettingsModal(false);
  };

  // Recalculate Belt Formula
  useEffect(() => {
    const C = parseFloat(calcC);
    const D = parseFloat(calcD);
    const d = parseFloat(calcd);
    if (!isNaN(C) && !isNaN(D) && !isNaN(d) && C > 0 && D > 0 && d > 0 && D >= d) {
      const length = 2 * C + 1.57 * (D + d) + Math.pow(D - d, 2) / (4 * C);
      const ratio = D / d;
      setCalcResult({
        length: Math.round(length),
        ratio: Math.round(ratio * 100) / 100,
      });
    } else {
      setCalcResult(null);
    }
  }, [calcC, calcD, calcd]);

  // Clean camera stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const persistCapturedImageOnDevice = async (blob: Blob, originalName: string) => {
    setIsSavingCapturedImage(true);
    try {
      const saved = await saveCustomerDeviceImage(blob, currentUser?.id || 'guest', originalName);
      setCapturedImageId(saved.id);
      setImageEventId(null);
      setAnalysisError(null);
    } catch (error: any) {
      setCapturedImageId(null);
      setAnalysisError(error?.message || 'ذخیره تصویر در حافظه داخلی دستگاه انجام نشد.');
    } finally {
      setIsSavingCapturedImage(false);
    }
  };

  // Camera Handling
  const startCamera = async (facing: 'environment' | 'user' = cameraFacing) => {
    setCameraError(null);
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsCameraActive(true);
      setCameraFacing(facing);
    } catch (err: any) {
      console.warn('Camera failed:', err);
      setCameraError('دسترسی به دوربین برقرار نشد. می‌توانید از بارگذاری فایل استفاده نمایید.');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop());
      cameraStreamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const toggleCameraFacing = () => {
    const nextFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    startCamera(nextFacing);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      setCapturedImage(dataUrl);
      setCapturedImageId(null);
      setImageEventId(null);
      void fetch(dataUrl).then(response => response.blob()).then(blob => persistCapturedImageOnDevice(blob, 'camera-capture.jpg')).catch((error: unknown) => setAnalysisError(error instanceof Error ? error.message : 'ذخیره تصویر دوربین ناموفق بود.'));
      stopCamera();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCapturedImage(reader.result);
        setCapturedImageId(null);
        setImageEventId(null);
        void persistCapturedImageOnDevice(file, file.name);
        stopCamera();
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSelectPresetSample = (sample: IndustrialPresetSample) => {
    setCapturedImage(sample.imageUrl);
    setCapturedImageId(null);
    setImageEventId(null);
    stopCamera();
    setDimensionLength(sample.length ? sample.length.toString() : "");
    setDimensionWidth(sample.width ? sample.width.toString() : "");
    setDimensionPitch(sample.pitch ? sample.pitch.toString() : "");
    setPartApplication(sample.application);
    setPartMarking(sample.features);
  };

  const runAiPartAnalysis = async () => {
    if (!capturedImage) return;
    if (isSavingCapturedImage) {
      setAnalysisError('لطفاً صبر کنید تا تصویر در حافظه داخلی دستگاه ذخیره شود.');
      return;
    }
    // Guests may identify a part. Only authenticated customers create CRM history.
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    const selectedCategoryObj = PART_CATEGORIES.find(c => c.id === selectedPartCategory);
    const categoryPromptHint = selectedCategoryObj
      ? `[دسته‌بندی اعلامی قطعه: ${selectedCategoryObj.title} - ${selectedCategoryObj.subtitle}] `
      : '';
    const markingHint = partMarking ? `کد و مارکینگ حک‌شده روی بدنه قطعه: ${partMarking}. ` : '';
    const fullFeatures = `${categoryPromptHint}${markingHint}`;

    let activeImageEventId: string | null = imageEventId;
    let requestMimeType = 'image/jpeg';
    try {
      let imageBase64: string | undefined;
      let imageUrl: string | undefined;
      if (/^https?:\/\//i.test(capturedImage)) {
        imageUrl = capturedImage;
      } else {
        if (!capturedImageId) throw new Error('تصویر هنوز در حافظه داخلی دستگاه ذخیره نشده است؛ دوباره انتخاب کنید.');
        const localRecord = await getCustomerDeviceImage(capturedImageId);
        if (!localRecord) throw new Error('تصویر محلی پیدا نشد؛ دوباره انتخاب کنید.');
        if (currentUser) await adoptCustomerDeviceImage(capturedImageId, currentUser.id);
        requestMimeType = localRecord.mimeType;
        imageBase64 = await customerImageBlobToDataUrl(localRecord.blob);
        if (currentUser && !activeImageEventId) {
          const metadata = await getCustomerDeviceImageMetadata(capturedImageId);
          if (!metadata) throw new Error('اطلاعات تصویر محلی پیدا نشد.');
          try {
            const event = await createCustomerImageIdentification({
              deviceImageId: metadata.id,
              sha256: metadata.sha256,
              mimeType: metadata.mimeType,
              sizeBytes: metadata.sizeBytes,
              originalName: metadata.originalName,
            });
            activeImageEventId = event.id;
            setImageEventId(event.id);
          } catch (trackingError) {
            console.warn('[Customer image history] metadata sync unavailable', trackingError);
          }
        }
      }

      const result = await aiVisualSearchService.analyzePartWithAi({
        imageUrl,
        imageBase64,
        mimeType: requestMimeType,
        length: dimensionLength ? parseFloat(dimensionLength) : undefined,
        width: dimensionWidth ? parseFloat(dimensionWidth) : undefined,
        pitch: dimensionPitch ? parseFloat(dimensionPitch) : undefined,
        application: partApplication || selectedCategoryObj?.defaultApplication,
        features: fullFeatures,
        stage: 'refined',
      });

      if (activeImageEventId) {
        void completeCustomerImageIdentification(activeImageEventId, {
          status: (result.matchedProducts?.length || result.similarCandidates?.length) ? 'completed' : 'unmatched',
          detectedPartType: result.summary?.detectedPartType,
          summary: result.summary?.whatYouSee || result.summary?.visualAnalysis,
          technicalAdvice: result.technicalAdvice,
          matchedProductCodes: (result.matchedProducts || []).map(item => item.code),
          similarProductCodes: (result.similarCandidates || []).map(item => item.code),
          confidence: result.summary?.confidence,
        }).catch((error: unknown) => console.warn('[Customer image history] result sync unavailable', error));
      }
      setAnalysisResult(result);
    } catch (err: any) {
      if (activeImageEventId) void completeCustomerImageIdentification(activeImageEventId, { status: 'failed' }).catch(() => undefined);
      console.error('Part analysis error:', err);
      setAnalysisError(
        err?.message || 'خطا در ارتباط با موتور هوش مصنوعی فورزا. لطفاً مجدداً تلاش نمایید.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const transferAnalysisToChat = (item?: MatchedPartItem) => {
    setActiveWorkspaceTab('chat');
    const targetItem = item || analysisResult?.matchedProducts?.[0] || analysisResult?.similarCandidates?.[0];
    const candidateIsSimilar = Boolean(targetItem && (
      analysisResult?.similarCandidates?.some(candidate => candidate.code === targetItem.code) ||
      targetItem.visualVerdict === 'very_similar'
    ));
    const prompt = buildVisionConsultationPrompt(
      targetItem ? {
        code: targetItem.code,
        name: targetItem.name,
        brand: targetItem.brand,
        size: targetItem.specs?.find(spec => /اندازه|ابعاد|size/i.test(spec.key))?.value,
        isSimilar: candidateIsSimilar,
      } : undefined,
      analysisResult?.summary,
    );
    if (!prompt) return;
    if (!targetItem) {
      void handleSend(prompt);
      return;
    }
    const product: ConsultationProduct = {
      code: targetItem.code,
      name: targetItem.name,
      image: targetItem.catalogProduct?.images?.[0],
      link: '/product/' + encodeURIComponent(targetItem.code),
    };
    addProductToConsultation(product);
    // This is a customer-selected candidate, not proof of an exact match.
    // Persist only the selected code in CRM; never persist the customer's photo.
    if (imageEventId && currentUser) {
      void selectCustomerImageProduct(imageEventId, targetItem.code)
        .catch(() => console.warn('[Customer image history] candidate selection unavailable'));
    }
    void handleSend(prompt, product);
  };

  const persistConsultationForCrm = (
    sessionId: string,
    title: string,
    sessionMessages: Message[],
    summary: string,
    productsForTurn: ConsultationProduct[] = selectedConsultProducts,
  ) => {
    if (!currentUser || !sessionId || !sessionMessages.length) return;
    void saveCustomerConsultation({
      sessionId,
      title,
      messages: sessionMessages.slice(-32).map(message => ({
        id: message.id,
        role: message.sender === 'ai' ? 'assistant' : 'user',
        text: message.text.slice(0, 1800),
      })),
      productCodes: productsForTurn.map(product => product.code),
      products: productsForTurn.map(product => ({ code: product.code, name: product.name })),
      summary,
    }).catch((error: unknown) => console.warn('[FORZA CRM session sync]', error instanceof Error ? error.message : 'unavailable'));
  };

  const handleSend = async (queryText?: string, productForTurn?: ConsultationProduct) => {
    const textToSend = (queryText || inputQuery).trim();
    if (!textToSend) return;
    // Product detail can initiate a turn before the selected-product effect renders.
    const turnSelectedProducts: ConsultationProduct[] = [...selectedConsultProducts];
    const isInitialProductTurn = Boolean(queryText && queryText === entryParams.get('q')?.slice(0, 1500));
    const routeProductCode = isInitialProductTurn ? entryParams.get('productCode')?.trim() : undefined;
    const routeProductName = isInitialProductTurn ? entryParams.get('productName')?.trim() : undefined;
    if (routeProductCode && !turnSelectedProducts.some(item => item.code === routeProductCode)) {
      turnSelectedProducts.push({code: routeProductCode, name: routeProductName || routeProductCode});
    }
    if (productForTurn && !turnSelectedProducts.some(item => item.code === productForTurn.code)) {
      turnSelectedProducts.push(productForTurn);
    }
    if (turnSelectedProducts.length > 20) turnSelectedProducts.splice(0, turnSelectedProducts.length - 20);

    if (streamAbortControllerRef.current) {
      streamAbortControllerRef.current.abort();
      streamAbortControllerRef.current = null;
    }
    const abortCtrl = new AbortController();
    streamAbortControllerRef.current = abortCtrl;

    const userMessageId = 'u-' + Date.now();
    const uniqueResponseId = `resp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const timeNow = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    const newUserMessage: Message = {
      id: userMessageId,
      sender: 'user',
      text: textToSend,
      time: timeNow,
    };

    const aiMessageId = `ai-${uniqueResponseId}`;
    const initialAiMessage: Message = {
      id: aiMessageId,
      sender: 'ai',
      text: '',
      time: timeNow,
    };

    const updatedMessages = [...messages, newUserMessage, initialAiMessage];
    setMessages(updatedMessages);
    setInputQuery('');
    setLoading(true);

    const currentSession = sessions.find(s => s.id === activeSessionId);
    let sessionTitle = currentSession?.title || 'گفتگوی فنی';
    if (messages.length === 0 || sessionTitle === 'گفتگوی جدید') {
      sessionTitle = textToSend.slice(0, 32) + (textToSend.length > 32 ? '...' : '');
    }

    let streamedText = '';
    let streamedSuggestedAction: Message['suggestedAction'];

    try {
      const historyPayload = messages
        .filter(m => m.id !== aiMessageId)
        .slice(-6)
        .map(m => ({
          role: m.sender === 'user' ? 'user' : 'model',
          text: m.text,
        }));

      const industryPrefix =
        selectedIndustry !== 'general'
          ? `[حوزه صنعتی: ${
              INDUSTRY_DOMAINS.find(d => d.id === selectedIndustry)?.label || 'عمومی'
            }] `
          : '';

      const stageContext = entryParams.get("stage")?.slice(0, 150);
      const productContext = turnSelectedProducts.length
        ? `[محصولات انتخاب‌شده برای مشاوره: ${turnSelectedProducts.map(product => `${product.code} - ${product.name}${product.size ? ' (' + product.size + ')' : ''}`).join('؛ ')}] `
        : '';
      const queryWithContext = `${industryPrefix}${stageContext ? `[بخش خط تولید: ${stageContext}] ` : ""}${
        isDeeperResearchActive ? '[تحلیل عمیق و استاندارد فنی] ' : ''
      }${productContext}${textToSend}`;

      let finalAiText = '';
      const res = await fetch(apiUrl('/api/ai/consult-stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          query: queryWithContext,
          history: historyPayload,
          responseId: uniqueResponseId,
          includeAudio: false,
          productCodes: turnSelectedProducts.map(product => product.code),
        }),
      });

      finalAiText = await consumeForzaTextStream(
        res,
        (_chunk, accumulatedText) => {
          if (abortCtrl.signal.aborted || streamAbortControllerRef.current !== abortCtrl) return;
          streamedText = accumulatedText;
          setMessages(prev =>
            prev.map(m => (m.id === aiMessageId ? { ...m, text: accumulatedText } : m))
          );
        },
        undefined,
        completed => {
          streamedSuggestedAction = completed.suggestedAction;
        },
      );
      if (abortCtrl.signal.aborted || streamAbortControllerRef.current !== abortCtrl) return;
      streamedText = finalAiText;
      setMessages(prev =>
        prev.map(m =>
          m.id === aiMessageId
            ? { ...m, text: finalAiText, suggestedAction: streamedSuggestedAction }
            : m
        )
      );

      const finalMessagesList = [
        ...messages,
        newUserMessage,
        {
          id: aiMessageId,
          sender: 'ai' as const,
          text: finalAiText,
          time: timeNow,
          suggestedAction: streamedSuggestedAction,
        },
      ];
      const updatedSessions = sessions.map(s =>
        s.id === activeSessionId
          ? {
              ...s,
              title: sessionTitle,
              timestamp: Date.now(),
              messages: finalMessagesList,
            }
          : s
      );
      saveSessionsToStorage(updatedSessions);
      persistConsultationForCrm(activeSessionId, sessionTitle, finalMessagesList, finalAiText, turnSelectedProducts);
    } catch (error) {
      // A superseded or explicitly cancelled request must not overwrite the
      // newer turn. In particular, never retry through /api/ai/consult here:
      // that legacy route may select a different provider or paid Gemini.
      if (abortCtrl.signal.aborted || streamAbortControllerRef.current !== abortCtrl) return;

      const failureText = streamedText.trim()
        ? `${streamedText}\n\nپاسخ کامل از سرویس دریافت نشد؛ متن بالا ممکن است ناقص باشد. لطفاً درخواست را دوباره ارسال کنید.`
        : 'سرویس مشاوره فعلاً پاسخ کامل نداد. لطفاً کمی بعد دوباره تلاش کنید.';

      const finalMessagesList = [
        ...messages,
        newUserMessage,
        {
          id: aiMessageId,
          sender: 'ai' as const,
          text: failureText,
          time: timeNow,
        },
      ];
      setMessages(finalMessagesList);

      const updatedSessions = sessions.map(s =>
        s.id === activeSessionId
          ? {
              ...s,
              title: sessionTitle,
              timestamp: Date.now(),
              messages: finalMessagesList,
            }
          : s
      );
      saveSessionsToStorage(updatedSessions);
      persistConsultationForCrm(activeSessionId, sessionTitle, finalMessagesList, failureText, turnSelectedProducts);
    } finally {
      // Only the request that still owns the composer may clear its loading
      // state; an older aborted request must not stop a newer request's spinner.
      if (streamAbortControllerRef.current === abortCtrl) {
        streamAbortControllerRef.current = null;
        setLoading(false);
        setTimeout(scrollToBottom, 100);
      }
    }
  };

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleFeedback = useCallback((id: string, vote: 'up' | 'down') => {
    setFeedbackState(prev => ({ ...prev, [id]: vote }));
  }, []);

  const handleNavigateLink = useCallback((link: string) => {
    navigate(link);
  }, [navigate]);

  const handleCopyChatLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2500);
  };

  const startCatalogConsultation = (product: ConsultationProduct) => {
    addProductToConsultation(product);
    setActiveWorkspaceTab('chat');
    void handleSend(
      'برای قطعه «' + product.name + '» با کد ' + product.code +
      (product.size ? ' و ابعاد ' + product.size : '') +
      ' مشاوره فنی می‌خواهم. کاربردهای ثبت‌شده و نکات انتخاب را توضیح بده، سازگاری را قطعی فرض نکن و یک سؤال ضروری درباره دستگاه یا شرایط کار من بپرس.',
      product,
    );
  };
  const startCatalogFamilyConsultation = (family: WorkspaceCatalogResult) =>
    startCatalogConsultation({
      code: family.code,
      name: family.name,
      image: typeof family.images?.[0] === 'string' ? family.images[0] : undefined,
      link: family.link,
    });

  // Group and filter sessions
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const entrySentRef=useRef<string | null>(null);
  useEffect(()=>{
    const query=entryParams.get('q');
    const entryKey=entryParams.toString();
    if(!query || !activeSessionId || entrySentRef.current===entryKey)return;
    entrySentRef.current=entryKey;
    void handleSend(query.slice(0,1500));
  },[entryParams,activeSessionId]);
  const filteredSessions = sessions.filter(s =>
    sessionSearchQuery.trim()
      ? s.title.toLowerCase().includes(sessionSearchQuery.toLowerCase())
      : true
  );

  const todaySessions = filteredSessions.filter(
    s => now - s.timestamp < oneDay && s.messages.length > 0
  );
  const yesterdaySessions = filteredSessions.filter(
    s => now - s.timestamp >= oneDay && now - s.timestamp < 2 * oneDay && s.messages.length > 0
  );
  const olderSessions = filteredSessions.filter(
    s => now - s.timestamp >= 2 * oneDay && s.messages.length > 0
  );

  // Render Sidebar
  const renderSidebarContent = () => (
    <div className="h-full flex flex-col justify-between select-none bg-[#F5F6F8] border-l border-[#DCE1E7]">
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Sidebar Header */}
        <div className="h-14 px-3.5 border-b border-[#DCE1E7] bg-[#FFFFFF] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#FFF4EC] border border-[#F8D3B8] flex items-center justify-center shrink-0">
              <CognivoGeometricLogo className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="block font-black text-sm tracking-tight text-[#2B313A] truncate">
                میزکار FORZA
              </span>
              <span className="block text-[10px] text-[#777A7D] font-medium truncate">
                مشاور مهندسی خطوط تولید
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsSidebarOpen(false);
              setIsMobileDrawerOpen(false);
            }}
            title="بستن منو"
            aria-label="بستن منو"
            className="min-w-[38px] min-h-[38px] rounded-xl text-[#55565A] hover:text-[#2B313A] hover:bg-[#EAECEF] flex items-center justify-center transition-colors cursor-pointer"
          >
            <PanelLeftClose className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Action Controls */}
        <div className="p-3 space-y-2.5">
          {/* New Chat Button */}
          <button
            type="button"
            onClick={() => createNewSession()}
            className="w-full min-h-[42px] py-2 px-3.5 rounded-xl bg-[#E06518] hover:bg-[#C95210] active:scale-[0.99] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>مشاوره جدید</span>
          </button>

          {/* Quick Search in History */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#777A7D] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={sessionSearchQuery}
              onChange={e => setSessionSearchQuery(e.target.value)}
              placeholder="جستجو در سوابق گفتگو..."
              className="w-full h-9 pr-8.5 pl-8 bg-[#FFFFFF] border border-[#DCE1E7] rounded-xl text-xs text-[#2B313A] placeholder-[#777A7D] focus:outline-none focus:border-[#E06518]"
            />
            {sessionSearchQuery && (
              <button
                type="button"
                onClick={() => setSessionSearchQuery('')}
                aria-label="پاک کردن جستجو"
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-[#777A7D] hover:text-[#2B313A] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Engineering Tools */}
          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setIsMobileDrawerOpen(false);
                navigate('/ai-forza');
              }}
              className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-[#FFFFFF] border border-[#DCE1E7] hover:border-[#E06518] flex items-center justify-between text-right transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-[#FFF4EC] text-[#E06518] flex items-center justify-center shrink-0">
                  <LiveVoiceIcon size={16} />
                </div>
                <div className="text-right min-w-0">
                  <div className="text-xs font-bold text-[#2B313A] group-hover:text-[#E06518] truncate">
                    تماس صوتی چهره‌به‌چهره
                  </div>
                  <div className="text-[10px] text-[#777A7D] truncate">مکالمه زنده با FORZA</div>
                </div>
              </div>
              <ChevronLeft className="w-4 h-4 text-[#777A7D] group-hover:text-[#E06518] shrink-0 transition-colors" />
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  navigate('/identify-part?from=workspace');
                }}
                className="min-h-[40px] px-2.5 py-2 rounded-xl bg-[#FFFFFF] border border-[#DCE1E7] hover:border-[#E06518] text-[#2B313A] hover:text-[#E06518] text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <VisualScannerIcon size={15} className="text-[#E06518] shrink-0" />
                <span>اسکن قطعه</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsMobileDrawerOpen(false);
                  setShowCalculatorModal(true);
                }}
                className="min-h-[40px] px-2.5 py-2 rounded-xl bg-[#FFFFFF] border border-[#DCE1E7] hover:border-[#E06518] text-[#2B313A] hover:text-[#E06518] text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <DinCalculatorIcon size={15} className="text-[#E06518] shrink-0" />
                <span>محاسبه DIN</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-4 text-right">
          {todaySessions.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[11px] font-bold text-[#777A7D]">امروز</div>
              <div className="space-y-1">
                {todaySessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => switchSession(session.id)}
                    className={`group min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      activeSessionId === session.id && activeWorkspaceTab === 'chat'
                        ? 'bg-[#FFFFFF] text-[#E06518] font-bold border border-[#DCE1E7] shadow-2xs'
                        : 'text-[#55565A] hover:bg-[#EAECEF]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-75" />
                      <span className="truncate">{session.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={e => deleteSession(session.id, e)}
                      title="حذف گفتگو"
                      aria-label={`حذف ${session.title}`}
                      className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg opacity-70 lg:opacity-0 lg:group-hover:opacity-100 text-[#777A7D] hover:text-rose-600 hover:bg-rose-50 transition-all shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {yesterdaySessions.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[11px] font-bold text-[#777A7D]">دیروز</div>
              <div className="space-y-1">
                {yesterdaySessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => switchSession(session.id)}
                    className={`group min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      activeSessionId === session.id && activeWorkspaceTab === 'chat'
                        ? 'bg-[#FFFFFF] text-[#E06518] font-bold border border-[#DCE1E7] shadow-2xs'
                        : 'text-[#55565A] hover:bg-[#EAECEF]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-75" />
                      <span className="truncate">{session.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={e => deleteSession(session.id, e)}
                      title="حذف گفتگو"
                      aria-label={`حذف ${session.title}`}
                      className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg opacity-70 lg:opacity-0 lg:group-hover:opacity-100 text-[#777A7D] hover:text-rose-600 hover:bg-rose-50 transition-all shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {olderSessions.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[11px] font-bold text-[#777A7D]">روزهای گذشته</div>
              <div className="space-y-1">
                {olderSessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => switchSession(session.id)}
                    className={`group min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      activeSessionId === session.id && activeWorkspaceTab === 'chat'
                        ? 'bg-[#FFFFFF] text-[#E06518] font-bold border border-[#DCE1E7] shadow-2xs'
                        : 'text-[#55565A] hover:bg-[#EAECEF]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-75" />
                      <span className="truncate">{session.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={e => deleteSession(session.id, e)}
                      title="حذف گفتگو"
                      aria-label={`حذف ${session.title}`}
                      className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded-lg opacity-70 lg:opacity-0 lg:group-hover:opacity-100 text-[#777A7D] hover:text-rose-600 hover:bg-rose-50 transition-all shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sessions.every(s => s.messages.length === 0) && (
            <div className="p-4 text-center text-xs text-[#777A7D] leading-relaxed">
              هنوز گفتگویی ذخیره نشده است. با ارسال اولین پرسش، تاریخچه به صورت خودکار ثبت می‌شود.
            </div>
          )}
        </div>
      </div>

      {/* Settings & Industry Footer */}
      <div className="p-3 border-t border-[#DCE1E7] bg-[#FFFFFF] space-y-2 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => {
            setIsMobileDrawerOpen(false);
            setShowSettingsModal(true);
          }}
          className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-[#F6F7F9] border border-[#DCE1E7] text-[#2B313A] hover:border-[#E06518] hover:text-[#E06518] flex items-center justify-between text-xs font-bold transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <SlidersHorizontal className="w-4 h-4 text-[#E06518] shrink-0" />
            <span className="truncate">تنظیمات و حوزه صنعتی</span>
          </div>
          <span className="text-[10px] text-[#777A7D] shrink-0">ویرایش</span>
        </button>

        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <Factory className="w-4 h-4 text-[#777A7D] shrink-0" />
            <span className="text-[11px] font-semibold text-[#55565A] truncate">
              {INDUSTRY_DOMAINS.find(d => d.id === selectedIndustry)?.label || 'صنایع عمومی'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            title="بازگشت به فروشگاه"
            aria-label="بازگشت به فروشگاه"
            className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-[#55565A] hover:text-[#E06518] hover:bg-[#F6F7F9] transition-colors cursor-pointer shrink-0"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="h-[100dvh] max-h-[100dvh] w-full flex flex-col bg-[#F6F7F9] text-[#2B313A] overflow-hidden select-none"
      dir="rtl"
    >
      <div className="flex-1 flex overflow-hidden relative">
        {/* 1. DESKTOP SIDEBAR */}
        <aside
          hidden={identificationOnly}
          className={`${
            !identificationOnly && isSidebarOpen ? 'w-72 xl:w-[300px]' : 'w-0 hidden'
          } transition-all duration-200 ease-out hidden lg:flex flex-col shrink-0 overflow-hidden z-20`}
        >
          {renderSidebarContent()}
        </aside>

        {/* 2. MOBILE SLIDE-OVER DRAWER */}
        {!identificationOnly && isMobileDrawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex justify-start">
            <div
              className="fixed inset-0 bg-[#1E242D]/50 backdrop-blur-xs transition-opacity"
              onClick={() => setIsMobileDrawerOpen(false)}
            />
            <div className="relative w-80 max-w-[86vw] h-full shadow-2xl flex flex-col z-50 bg-[#F5F6F8] animate-in slide-in-from-right duration-200">
              {renderSidebarContent()}
            </div>
          </div>
        )}

        {/* 3. MAIN WORKSPACE CONTAINER */}
        <main className="flex-1 flex flex-col bg-[#F6F7F9] overflow-hidden min-w-0">
          {/* Top Header Bar (Clean 3-Zone Contract) */}
          {identificationOnly ? (
            <header className="h-14 px-4 border-b border-[#DCE1E7] flex items-center justify-between bg-[#FFFFFF] shrink-0">
              <strong className="text-sm font-black text-[#2B313A]">شناسایی هوشمند قطعه</strong>
              <button
                type="button"
                onClick={() => navigate('/ai-consult')}
                className="min-h-[40px] px-4 py-2 rounded-xl border border-[#DCE1E7] hover:border-[#E06518] text-xs font-bold text-[#2B313A] cursor-pointer"
              >
                بازگشت به میزکار
              </button>
            </header>
          ) : (
            <header className="h-14 px-2.5 sm:px-5 border-b border-[#DCE1E7] flex items-center justify-between gap-2 sm:gap-4 shrink-0 bg-[#FFFFFF] z-20">
              {/* Zone 1: Brand & Sidebar Toggle */}
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setIsMobileDrawerOpen(true)}
                  className="lg:hidden min-w-[40px] min-h-[40px] rounded-xl text-[#2B313A] hover:bg-[#F6F7F9] transition-colors cursor-pointer border border-[#DCE1E7] bg-[#FFFFFF] flex items-center justify-center shrink-0"
                  title="تاریخچه و ابزارهای میزکار"
                  aria-label="باز کردن منوی میزکار"
                >
                  <PanelLeft className="w-4.5 h-4.5" />
                </button>

                {!isSidebarOpen && (
                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(true)}
                    title="نمایش نوار کناری"
                    aria-label="نمایش نوار کناری"
                    className="hidden lg:flex min-w-[40px] min-h-[40px] rounded-xl text-[#55565A] hover:text-[#2B313A] hover:bg-[#F6F7F9] border border-[#DCE1E7] items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <PanelLeft className="w-4.5 h-4.5" />
                  </button>
                )}

                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-[#FFF4EC] border border-[#F8D3B8] flex items-center justify-center shrink-0">
                    <CognivoGeometricLogo className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 text-right">
                    <span className="block font-black text-xs sm:text-sm text-[#2B313A] tracking-tight truncate">
                      میزکار هوشمند FORZA
                    </span>
                    <span className="hidden sm:block text-[10px] text-[#777A7D] truncate">
                      مشاوره مهندسی و کاتالوگ قطعات اطلس
                    </span>
                  </div>
                </div>
              </div>

              {/* Zone 2: Desktop Mode Switcher */}
              <div className="hidden md:flex items-center gap-1 p-1 bg-[#F6F7F9] rounded-xl border border-[#DCE1E7] shrink-0">
                <button
                  type="button"
                  onClick={() => (identificationOnly ? navigate('/ai-consult') : setActiveWorkspaceTab('chat'))}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                    activeWorkspaceTab === 'chat'
                      ? 'bg-[#FFFFFF] text-[#E06518] shadow-2xs border border-[#DCE1E7]'
                      : 'text-[#55565A] hover:text-[#2B313A]'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span>گفتگوی مهندسی</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/identify-part?from=workspace')}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                    activeWorkspaceTab === 'visual_studio'
                      ? 'bg-[#FFFFFF] text-[#E06518] shadow-2xs border border-[#DCE1E7]'
                      : 'text-[#55565A] hover:text-[#2B313A]'
                  }`}
                >
                  <VisualScannerIcon size={15} className="text-[#E06518] shrink-0" />
                  <span>شناسایی تصویری قطعه</span>
                </button>
              </div>

              {/* Zone 3: Quick Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => navigate('/ai-forza')}
                  className="min-h-[38px] px-2.5 sm:px-3.5 rounded-xl bg-[#E06518] hover:bg-[#C95210] text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs whitespace-nowrap"
                  title="مکالمه صوتی و چهره‌به‌چهره با FORZA"
                >
                  <LiveVoiceIcon size={16} />
                  <span className="hidden xs:inline">تماس زنده</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowCalculatorModal(true)}
                  title="محاسبه‌گر طول تسمه DIN 2215"
                  aria-label="محاسبه‌گر طول تسمه DIN 2215"
                  className="min-w-[38px] min-h-[38px] rounded-xl text-[#55565A] hover:text-[#E06518] hover:bg-[#FFF4EC] transition-colors cursor-pointer border border-[#DCE1E7] bg-[#FFFFFF] flex items-center justify-center"
                >
                  <DinCalculatorIcon size={17} />
                </button>

                <button
                  type="button"
                  onClick={handleCopyChatLink}
                  title="اشتراک‌گذاری میزکار"
                  aria-label="اشتراک‌گذاری میزکار"
                  className="hidden sm:flex min-w-[38px] min-h-[38px] rounded-xl text-[#55565A] hover:text-[#2B313A] hover:bg-[#F6F7F9] transition-colors cursor-pointer border border-[#DCE1E7] bg-[#FFFFFF] items-center justify-center"
                >
                  <Share2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  title="تنظیمات میزکار"
                  aria-label="تنظیمات میزکار"
                  className="hidden sm:flex min-w-[38px] min-h-[38px] rounded-xl text-[#55565A] hover:text-[#2B313A] hover:bg-[#F6F7F9] transition-colors cursor-pointer border border-[#DCE1E7] bg-[#FFFFFF] items-center justify-center"
                >
                  <Settings className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/')}
                  title="بازگشت به فروشگاه صنعت پیش"
                  aria-label="بازگشت به فروشگاه"
                  className="min-w-[38px] min-h-[38px] rounded-xl text-[#55565A] hover:text-[#E06518] hover:bg-[#F6F7F9] transition-colors cursor-pointer border border-[#DCE1E7] bg-[#FFFFFF] flex items-center justify-center"
                >
                  <Home className="w-4 h-4" />
                </button>
              </div>
            </header>
          )}

          {/* Mobile Mode Switcher Strip (Compact 46px) */}
          <div
            hidden={identificationOnly}
            className="md:hidden bg-[#FFFFFF] border-b border-[#DCE1E7] px-2.5 py-1.5 shrink-0 z-10"
          >
            <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#F6F7F9] rounded-xl border border-[#DCE1E7]">
              <button
                type="button"
                onClick={() => (identificationOnly ? navigate('/ai-consult') : setActiveWorkspaceTab('chat'))}
                className={`min-h-[36px] px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                  activeWorkspaceTab === 'chat'
                    ? 'bg-[#FFFFFF] text-[#E06518] shadow-2xs border border-[#DCE1E7]'
                    : 'text-[#55565A]'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span>گفتگوی مهندسی</span>
                {messages.length > 0 && (
                  <span className="text-[10px] font-mono tabular-nums text-[#777A7D]">
                    ({messages.length})
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => navigate('/identify-part?from=workspace')}
                className={`min-h-[36px] px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                  activeWorkspaceTab === 'visual_studio'
                    ? 'bg-[#FFFFFF] text-[#E06518] shadow-2xs border border-[#DCE1E7]'
                    : 'text-[#55565A]'
                }`}
              >
                <VisualScannerIcon size={15} className="text-[#E06518] shrink-0" />
                <span>شناسایی قطعه</span>
              </button>
            </div>
          </div>

          {/* Share Toast */}
          {showShareToast && (
            <div className="fixed top-16 left-1/2 -translate-x-1/2 px-4 py-2 bg-[#2B313A] text-white text-xs font-bold rounded-xl shadow-xl flex items-center gap-2 z-50">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>لینک میزکار کپی شد</span>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 1: VISUAL PART IDENTIFICATION STUDIO                         */}
          {/* ================================================================= */}
          {identificationOnly || activeWorkspaceTab === 'visual_studio' ? (
            <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-5 max-w-4xl mx-auto w-full pb-20 md:pb-8">
              {/* Studio Header Banner */}
              <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl bg-[#FFFFFF] border border-[#DCE1E7] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold text-[#E06518] mb-1">
                    سامانه بینایی ماشین FORZA · تطبیق با کاتالوگ اطلس
                  </div>
                  <h2 className="text-base sm:text-lg font-black text-[#2B313A]">
                    استودیوی شناسایی و تطبیق تصویری قطعات
                  </h2>
                  <p className="text-xs text-[#55565A] mt-1 leading-relaxed">
                    با انتخاب دسته‌بندی و ارسال تصویر، پروفیل، گام دندانه و کدهای فنی قطعه بررسی می‌شود.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => (identificationOnly ? navigate('/ai-consult') : setActiveWorkspaceTab('chat'))}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#DCE1E7] hover:border-[#E06518] text-[#2B313A] hover:text-[#E06518] text-xs font-bold bg-[#FFFFFF] flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>انتقال به گفتگوی مهندسی</span>
                </button>
              </div>

              {/* STEP 1: CATEGORY SELECTION */}
              <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl bg-[#FFFFFF] border border-[#DCE1E7] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-[#E06518] text-white text-xs font-black flex items-center justify-center shrink-0 tabular-nums">
                      ۱
                    </span>
                    <h3 className="font-black text-xs sm:text-sm text-[#2B313A]">
                      انتخاب دسته‌بندی قطعه صنعتی
                    </h3>
                  </div>
                  <span className="text-[11px] text-[#777A7D] hidden sm:inline">
                    {PART_CATEGORIES.find(c => c.id === selectedPartCategory)?.recommendedParams}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                  {PART_CATEGORIES.map(category => {
                    const CategoryIcon = category.icon;
                    const isSelected = selectedPartCategory === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setSelectedPartCategory(category.id)}
                        className={`p-3 rounded-xl sm:rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between min-h-[88px] ${
                          isSelected
                            ? 'border-[#E06518] bg-[#FFF4EC]/60 shadow-2xs'
                            : 'border-[#DCE1E7] bg-[#FFFFFF] hover:bg-[#F6F7F9]'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                              isSelected
                                ? 'bg-[#E06518] text-white'
                                : 'bg-[#F6F7F9] text-[#55565A]'
                            }`}
                          >
                            <CategoryIcon size={17} />
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-[#E06518]" />}
                        </div>

                        <div>
                          <h4
                            className={`font-black text-xs ${
                              isSelected ? 'text-[#C95210]' : 'text-[#2B313A]'
                            }`}
                          >
                            {category.title}
                          </h4>
                          <p className="text-[10px] text-[#777A7D] mt-0.5 line-clamp-1">
                            {category.subtitle}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* STEP 2: CAMERA CAPTURE OR FILE UPLOAD */}
              <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl bg-[#FFFFFF] border border-[#CBD2D8] shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#E06518] text-white text-xs font-black flex items-center justify-center shrink-0">
                      ۲
                    </span>
                    <h3 className="font-black text-xs sm:text-sm text-[#2B313A]">
                      ثبت تصویر قطعه (دوربین زنده یا بارگذاری فایل)
                    </h3>
                  </div>

                  {capturedImage && (
                    <button
                      type="button"
                      onClick={() => {
                        setCapturedImage(null);
                        setAnalysisResult(null);
                      }}
                      className="text-xs text-rose-600 hover:text-rose-700 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف و ثبت مجدد</span>
                    </button>
                  )}
                </div>

                {/* Viewport or Preview */}
                {!capturedImage ? (
                  <div className="space-y-3">
                    {isCameraActive ? (
                      <div className="relative rounded-2xl overflow-hidden bg-black aspect-video max-h-80 mx-auto border-2 border-[#E06518]">
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          className="w-full h-full object-cover"
                        />
                        {/* Camera Scanline overlay */}
                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                          <div className="w-48 h-48 border border-white/60 rounded-xl relative">
                            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#E06518]" />
                            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#E06518]" />
                            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#E06518]" />
                            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#E06518]" />
                          </div>
                        </div>

                        {/* Camera controls */}
                        <div className="absolute bottom-3 inset-x-0 flex items-center justify-center gap-3">
                          <button
                            type="button"
                            onClick={toggleCameraFacing}
                            className="p-2.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                            title="تغییر دوربین"
                          >
                            <SwitchCamera className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={capturePhoto}
                            className="w-12 h-12 rounded-full bg-[#E06518] text-white flex items-center justify-center shadow-lg border-2 border-white active:scale-95"
                            title="ثبت تصویر"
                          >
                            <Camera className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            onClick={stopCamera}
                            className="p-2.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                            title="انصراف"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => startCamera()}
                          className="p-6 rounded-2xl border-2 border-dashed border-[#CBD2D8] hover:border-[#E06518] hover:bg-orange-50/20 flex flex-col items-center justify-center text-center transition-all cursor-pointer group"
                        >
                          <div className="w-12 h-12 rounded-full bg-orange-100 text-[#E06518] flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                            <Camera className="w-6 h-6" />
                          </div>
                          <span className="font-bold text-xs sm:text-sm text-[#2B313A]">
                            فعال‌سازی دوربین زنده
                          </span>
                          <span className="text-[11px] text-[#777A7D] mt-0.5">
                            تصویربرداری مستقیم از قطعه یا خط تولید
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-6 rounded-2xl border-2 border-dashed border-[#CBD2D8] hover:border-[#E06518] hover:bg-orange-50/20 flex flex-col items-center justify-center text-center transition-all cursor-pointer group"
                        >
                          <div className="w-12 h-12 rounded-full bg-[#DEE2E5] text-[#55565A] flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                            <Upload className="w-6 h-6" />
                          </div>
                          <span className="font-bold text-xs sm:text-sm text-[#2B313A]">
                            بارگذاری تصویر از گالری
                          </span>
                          <span className="text-[11px] text-[#777A7D] mt-0.5">
                            فرمت‌های JPG، PNG، WEBP
                          </span>
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileUpload}
                        />
                      </div>
                    )}

                    {cameraError && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        {cameraError}
                      </div>
                    )}

                    {/* Industrial Preset Samples Carousel */}
                    <div className="pt-2">
                      <div className="text-[11px] font-bold text-[#777A7D] mb-2">
                        یا انتخاب سریع از نمونه‌های صنعتی آماده:
                      </div>
                      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                        {INDUSTRIAL_PRESET_SAMPLES.map(sample => (
                          <button
                            key={sample.id}
                            type="button"
                            onClick={() => handleSelectPresetSample(sample)}
                            className="px-2.5 py-1.5 rounded-xl border border-[#CBD2D8] bg-[#FFFFFF] hover:border-[#E06518] text-right shrink-0 flex items-center gap-2 cursor-pointer shadow-2xs"
                          >
                            <img
                              src={sample.imageUrl}
                              alt={sample.title}
                              className="w-8 h-8 rounded-lg object-contain bg-[#F4F4F5]"
                            />
                            <div className="text-right">
                              <div className="text-[11px] font-bold text-[#2B313A] truncate max-w-[120px]">
                                {sample.title}
                              </div>
                              <div className="text-[9px] text-[#777A7D]">{sample.subtitle}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Captured image preview & run button */
                  <div className="space-y-4">
                    <div className="relative rounded-2xl overflow-hidden bg-[#F4F4F5] border border-[#CBD2D8] max-h-72 flex items-center justify-center p-2">
                      <img
                        src={capturedImage}
                        alt="تصویر ثبت‌شده"
                        className="max-h-64 object-contain rounded-xl"
                      />
                    </div>

                    {/* Optional Dimensions Inputs */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <label className="text-[11px] text-[#55565A] block mb-1">
                          طول / عرض (mm):
                        </label>
                        <input
                          type="number"
                          value={dimensionLength}
                          onChange={e => setDimensionLength(e.target.value)}
                          placeholder="مثلاً ۱۲۰۰"
                          className="w-full h-8 px-2.5 bg-[#F4F4F5] border border-[#CBD2D8] rounded-lg text-center"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-[#55565A] block mb-1">
                          گام دندانه (mm):
                        </label>
                        <input
                          type="number"
                          value={dimensionPitch}
                          onChange={e => setDimensionPitch(e.target.value)}
                          placeholder="مثلاً ۸"
                          className="w-full h-8 px-2.5 bg-[#F4F4F5] border border-[#CBD2D8] rounded-lg text-center"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[11px] text-[#55565A] block mb-1">
                          کد یا مارکینگ حک‌شده:
                        </label>
                        <input
                          type="text"
                          value={partMarking}
                          onChange={e => setPartMarking(e.target.value)}
                          placeholder="مثلاً FORZA 8M 1200 یا NSK 6205"
                          className="w-full h-8 px-2.5 bg-[#F4F4F5] border border-[#CBD2D8] rounded-lg text-right"
                        />
                      </div>
                    </div>

                    {/* Run Analysis Button */}
                    <button
                      type="button"
                      onClick={runAiPartAnalysis}
                      disabled={isAnalyzing}
                      className="w-full min-h-[46px] py-3 rounded-xl bg-[#E06518] hover:bg-[#C95210] active:scale-[0.99] disabled:bg-[#CBD2D8] text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                    >
                      {isSavingCapturedImage ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> ذخیره روی دستگاه...</>
                      ) : isAnalyzing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>سامانه در حال استخراج و تحلیل فنی قطعه...</span>
                        </>
                      ) : (
                        <>
                          <VisualScannerIcon size={17} />
                          <span>شروع تحلیل هوشمند و تطبیق با کاتالوگ اطلس</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* STEP 3: ANALYSIS RESULTS */}
              {analysisError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {analysisError}
                </div>
              )}

              {analysisResult && (
                <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl bg-[#FFFFFF] border border-[#DCE1E7] shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#E6E9EE]">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white text-xs font-black flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                      <h3 className="font-black text-sm text-[#2B313A]">
                        نتیجه تحلیل بینایی ماشین FORZA
                      </h3>
                    </div>
                    <span className="text-xs font-bold text-[#E06518] bg-orange-50 px-2 py-0.5 rounded-lg border border-orange-200">
                      دقت تطبیق: {analysisResult.summary.confidence}%
                    </span>
                  </div>

                  {/* Summary Box */}
                  <div className="p-3.5 rounded-xl bg-[#F4F4F5] border border-[#CBD2D8] text-xs space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <span className="text-[#777A7D] block text-[10px]">نوع قطعه:</span>
                        <strong className="text-[#2B313A]">
                          {analysisResult.summary.detectedPartType}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[#777A7D] block text-[10px]">پروفیل استاندارد:</span>
                        <strong className="text-[#2B313A]">
                          {analysisResult.summary.detectedProfile}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[#777A7D] block text-[10px]">خانواده قطعه:</span>
                        <strong className="text-[#2B313A]">
                          {analysisResult.summary.partFamilyFarsi || 'قطعات انتقال قدرت'}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[#777A7D] block text-[10px]">متریال:</span>
                        <strong className="text-[#2B313A]">
                          {analysisResult.summary.material || 'فولاد / لاستیک صنعتی'}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Matched Products */}
                  <div>
                    <h4 className="font-black text-xs sm:text-sm text-[#2B313A] mb-3">
                      قطعات منطبق و معادل در کاتالوگ اطلس:
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {analysisResult.matchedProducts.map(item => (
                        <div
                          key={item.code}
                          className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-[#FFFFFF] border border-[#CBD2D8] hover:border-[#E06518] shadow-2xs flex flex-col justify-between space-y-3"
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-16 h-16 rounded-xl bg-[#F4F4F5] border border-[#CBD2D8] p-1.5 flex items-center justify-center shrink-0">
                              <img
                                src={item.image || (item.catalogProduct ? item.catalogProduct.image : '')}
                                alt={item.name}
                                className="w-full h-full object-contain"
                              />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="px-1.5 py-0.5 rounded bg-orange-100 text-[#E06518] font-bold text-[10px]">
                                  {item.brand}
                                </span>
                                <span className="font-mono text-[10px] text-[#777A7D]">
                                  {item.code}
                                </span>
                              </div>
                              <h5 className="font-black text-xs text-[#2B313A] line-clamp-1">
                                {item.name}
                              </h5>
                              <p className="text-[11px] text-[#55565A] mt-1 line-clamp-2">
                                {item.matchReason}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-[#DEE2E5]">
                            <div className="text-xs">
                              {item.catalogProduct ? (
                                <span className="font-black text-[#2B313A]">
                                  قیمت و موجودی در پنل
                                </span>
                              ) : (
                                <span className="text-[#777A7D] text-[11px]">استعلام قیمت</span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5">
                              {item.catalogProduct && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if(currentUser)navigate(memberPath(currentUser,item.code));else openAuthModal(memberPath(null,item.code),"register");
                                    return;
                                    setAddedCartCode(item.code);
                                    setTimeout(() => setAddedCartCode(null), 2000);
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-[#E06518] hover:bg-[#C95210] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                >
                                  {false ? (
                                    <>
                                      <Check className="w-3 h-3" />
                                      <span>افزوده شد</span>
                                    </>
                                  ) : (
                                    <>
                                      <ShoppingCart className="w-3 h-3" />
                                      <span>خرید</span>
                                    </>
                                  )}
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => transferAnalysisToChat(item)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#DEE2E5] hover:bg-[#CBD2D8] text-[#2B313A] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <MessageSquare className="w-3 h-3" />
                                <span>چت مهندسی</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ================================================================= */
            /* TAB 2: ENGINEERING CHAT WORKSPACE                                 */
            /* ================================================================= */
            <div className="flex-1 overflow-hidden flex flex-col justify-between relative">
              {/* Compact Catalog Finder Toolbar */}
              <div className="relative z-30 shrink-0 border-b border-[#DCE1E7] bg-[#FFFFFF] px-2.5 sm:px-5 py-2">
                <WorkspaceCatalog
                  onSelect={startCatalogFamilyConsultation}
                  onAddToConsultation={startCatalogConsultation}
                />
              </div>

              {/* Message Feed Area */}
              <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 max-w-4xl mx-auto w-full">
                {messages.length === 0 ? (
                  /* INITIAL WELCOME SCREEN */
                  <div className="min-h-full flex flex-col items-center justify-center py-4 sm:py-8 max-w-2xl mx-auto text-center">
                    <div className="w-14 h-14 sm:w-18 sm:h-18 rounded-2xl bg-[#FFFFFF] border border-[#DCE1E7] shadow-2xs flex items-center justify-center mb-3.5">
                      <CognivoGeometricLogo className="w-9 h-9 sm:w-11 sm:h-11" />
                    </div>

                    <h1 className="text-lg sm:text-2xl font-black text-[#2B313A] mb-1 text-balance">
                      میزکار مهندسی FORZA
                    </h1>
                    <p className="text-xs sm:text-sm text-[#55565A] mb-3 max-w-md leading-relaxed">
                      انتخاب قطعه، استخراج کد فنی از کاتالوگ اطلس و محاسبات انتقال قدرت
                    </p>

                    {/* Active Industry Context Link */}
                    <button
                      type="button"
                      onClick={() => setShowSettingsModal(true)}
                      className="mb-5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#777A7D] hover:text-[#E06518] transition-colors cursor-pointer"
                    >
                      <Factory className="w-3.5 h-3.5 text-[#E06518]" />
                      <span>
                        حوزه فعال:{' '}
                        <strong className="text-[#2B313A]">
                          {INDUSTRY_DOMAINS.find(d => d.id === selectedIndustry)?.label || 'صنایع عمومی'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="underline underline-offset-2">تغییر</span>
                    </button>

                    {/* Quick Suggestions Grid */}
                    <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-right">
                      {PROMPT_SUGGESTIONS.map((item, idx) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSend(item.query)}
                            className="min-h-[68px] p-3.5 rounded-2xl bg-[#FFFFFF] border border-[#DCE1E7] hover:border-[#E06518] hover:shadow-xs text-right transition-all cursor-pointer group flex items-center gap-3"
                          >
                            <div className="w-10 h-10 rounded-xl bg-[#F6F7F9] group-hover:bg-[#FFF4EC] text-[#55565A] group-hover:text-[#E06518] flex items-center justify-center shrink-0 transition-colors">
                              <Icon size={20} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-black text-xs text-[#2B313A] group-hover:text-[#E06518] transition-colors truncate">
                                {item.title}
                              </div>
                              <div className="text-[11px] text-[#777A7D] mt-0.5 line-clamp-1">
                                {item.desc}
                              </div>
                            </div>
                            <ArrowUpLeft className="w-4 h-4 text-[#CBD2D8] group-hover:text-[#E06518] shrink-0 transition-colors" />
                          </button>
                        );
                      })}
                    </div>

                    {/* Direct Engineering Workbench Shortcuts */}
                    <div className="mt-3.5 w-full grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => navigate('/identify-part?from=workspace')}
                        className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#DCE1E7] hover:border-[#E06518] text-xs font-bold text-[#2B313A] hover:text-[#E06518] flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <VisualScannerIcon size={17} className="text-[#E06518]" />
                        <span>شناسایی با دوربین</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCalculatorModal(true)}
                        className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#DCE1E7] hover:border-[#E06518] text-xs font-bold text-[#2B313A] hover:text-[#E06518] flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <DinCalculatorIcon size={17} className="text-[#E06518]" />
                        <span>محاسبه‌گر DIN 2215</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ACTIVE MESSAGE STREAM */
                  <div className="space-y-4">
                    {messages.map(m => (
                      <WorkspaceMessageItem
                        key={m.id}
                        message={m}
                        isCopied={copiedId === m.id}
                        feedback={feedbackState[m.id]}
                        onCopy={copyToClipboard}
                        onFeedback={handleFeedback}
                        onNavigateLink={handleNavigateLink}
                      />
                    ))}

                    {loading && (
                      <div className="flex items-center justify-between gap-3 p-3.5 bg-[#FFFFFF] rounded-2xl border border-[#DCE1E7] text-xs shadow-2xs max-w-md">
                        <div className="flex items-center gap-2.5 text-[#E06518] font-bold min-w-0">
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          <span className="truncate">FORZA در حال استخراج پاسخ فنی...</span>
                        </div>
                        <button
                          type="button"
                          onClick={cancelActiveConsultation}
                          className="min-h-[32px] px-2.5 rounded-lg border border-[#DCE1E7] hover:border-rose-300 hover:bg-rose-50 text-[#55565A] hover:text-rose-700 font-bold text-[11px] flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                        >
                          <Square className="w-3 h-3 fill-current" />
                          <span>توقف</span>
                        </button>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Bottom Sticky Two-Tier Composer Bar */}
              <div className="px-2.5 sm:px-5 pt-2 bg-[#FFFFFF] border-t border-[#DCE1E7] shrink-0 z-20 pb-[max(0.65rem,env(safe-area-inset-bottom))]">
                {selectedConsultProducts.length > 0 && (
                  <div className="mx-auto mb-2 flex max-w-4xl flex-wrap gap-1.5">
                    {selectedConsultProducts.map(product => (
                      <span
                        key={product.code}
                        className="inline-flex max-w-[260px] items-center gap-1.5 rounded-xl border border-[#F8D3B8] bg-[#FFF4EC] px-2 py-1 text-[11px] font-bold text-[#9A3D08]"
                        title={product.name}
                      >
                        {product.image && (
                          <img
                            src={product.image}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-6 w-6 shrink-0 rounded-md bg-white object-contain"
                          />
                        )}
                        <span className="min-w-0 truncate">{product.name}</span>
                        <span dir="ltr" className="shrink-0 font-mono text-[10px]">
                          {product.code}
                        </span>
                        <button
                          type="button"
                          aria-label={`حذف ${product.code} از فهرست مشاوره`}
                          onClick={() =>
                            setSelectedConsultProducts(current =>
                              current.filter(item => item.code !== product.code)
                            )
                          }
                          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/70 text-[#9A3D08] cursor-pointer shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="max-w-4xl mx-auto w-full bg-[#F6F7F9] rounded-2xl border border-[#DCE1E7] p-2 sm:p-2.5 focus-within:border-[#E06518] focus-within:bg-[#FFFFFF] transition-colors">
                  {/* Tier 1: Full-width auto-resizing textarea */}
                  <textarea
                    ref={textareaRef}
                    value={inputQuery}
                    onChange={e => setInputQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    rows={1}
                    placeholder="پرسش فنی درباره تسمه، پولی، یاتاقان، زنجیر یا کد قطعه..."
                    className="w-full bg-transparent text-xs sm:text-sm text-[#2B313A] placeholder-[#777A7D] resize-none focus:outline-none min-h-[38px] max-h-32 px-1.5 py-1 leading-relaxed"
                  />

                  {/* Tier 2: Precision Tool Strip + Primary Send/Stop Action */}
                  <div className="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t border-[#E6E9EE]">
                    <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto scrollbar-none">
                      <button
                        type="button"
                        onClick={() => setIsDeeperResearchActive(!isDeeperResearchActive)}
                        className={`min-h-[36px] px-2.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          isDeeperResearchActive
                            ? 'bg-[#E06518] text-white shadow-2xs'
                            : 'bg-[#FFFFFF] border border-[#DCE1E7] text-[#55565A] hover:text-[#E06518] hover:border-[#E06518]'
                        }`}
                        title="تحلیل عمیق فنی بر اساس استانداردها"
                      >
                        <DeepEngineeringIcon size={15} />
                        <span>تحلیل عمیق</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => document.getElementById('forza-workspace-product-search')?.focus()}
                        className="min-h-[36px] px-2.5 rounded-xl bg-[#FFFFFF] border border-[#DCE1E7] text-[#55565A] hover:text-[#E06518] hover:border-[#E06518] text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        title="افزودن محصول از کاتالوگ"
                      >
                        <CatalogFinderIcon size={15} />
                        <span className="hidden sm:inline">کاتالوگ</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => navigate('/identify-part?from=workspace')}
                        className="min-h-[36px] px-2.5 rounded-xl bg-[#FFFFFF] border border-[#DCE1E7] text-[#55565A] hover:text-[#E06518] hover:border-[#E06518] text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        title="شناسایی قطعه با دوربین"
                      >
                        <VisualScannerIcon size={15} />
                        <span className="hidden xs:inline">شناسایی تصویر</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowCalculatorModal(true)}
                        className="min-h-[36px] px-2.5 rounded-xl bg-[#FFFFFF] border border-[#DCE1E7] text-[#55565A] hover:text-[#E06518] hover:border-[#E06518] text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        title="محاسبه‌گر تسمه DIN 2215"
                      >
                        <DinCalculatorIcon size={15} />
                        <span className="hidden md:inline">محاسبه‌گر DIN</span>
                      </button>
                    </div>

                    {loading ? (
                      <button
                        type="button"
                        onClick={cancelActiveConsultation}
                        className="min-h-[38px] px-3 rounded-xl bg-[#2B313A] hover:bg-[#1E242D] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                        title="توقف پاسخ"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>توقف</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSend()}
                        disabled={!inputQuery.trim()}
                        className="min-w-[40px] min-h-[38px] px-3 rounded-xl bg-[#E06518] hover:bg-[#C95210] disabled:bg-[#CBD2D8] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0 whitespace-nowrap"
                        title="ارسال پرسش"
                        aria-label="ارسال پرسش"
                      >
                        <Send className="w-4 h-4 -rotate-45 shrink-0" />
                        <span className="hidden sm:inline">ارسال</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Extracted Modals */}
      <DinCalculatorModal
        isOpen={showCalculatorModal}
        onClose={() => setShowCalculatorModal(false)}
        calcC={calcC}
        calcD={calcD}
        calcd={calcd}
        onChangeC={setCalcC}
        onChangeD={setCalcD}
        onChanged={setCalcd}
        calcResult={calcResult}
        onApplyToChat={(length, ratio) => {
          setShowCalculatorModal(false);
          setActiveWorkspaceTab('chat');
          void handleSend(
            `لطفاً تسمه مناسب با طول نامی ${length} میلیمتر و نسبت دور ۱:${ratio} را از کاتالوگ صنعت پیش و بازرگانی تسمه اطلس پیشنهاد دهید.`
          );
        }}
      />

      <WorkspaceSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        industries={INDUSTRY_DOMAINS}
        selectedIndustry={selectedIndustry}
        onSelectIndustry={setSelectedIndustry}
        calculationStandard={calculationStandard}
        onChangeCalculationStandard={setCalculationStandard}
        onClearAllHistory={clearAllHistory}
      />

      {/* Visual Part Search Wizard Modal */}
      {isVisualSearchModalOpen && (
        <Suspense fallback={<div role="status">در حال آماده‌سازی شناسایی تصویر…</div>}>
          <AiVisualPartSearchModal
            isOpen={isVisualSearchModalOpen}
            onClose={() => setIsVisualSearchModalOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
};
export default AiConsultPage;
