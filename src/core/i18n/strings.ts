export interface MediaEditorStrings {
  cancel: string;
  done: string;
  /** Commit-a-new-layer CTA (TextFocusEditor draft session). */
  add: string;
  /** Commit-changes-to-existing-layer CTA (TextFocusEditor edit session). */
  update: string;
  export: string;
  trim: string;
  setCover: string;
  /** Cover picker panel title. */
  pickCover: string;
  /** Cover picker primary CTA. */
  saveCover: string;
  editPhoto: string;
  editVideo: string;
  filters: string;
  /** Combined Filters+Overlays toolbar tab label. */
  effects: string;
  adjust: string;
  text: string;
  stickers: string;
  draw: string;
  /** Draw tool brush chips. */
  brushPen: string;
  brushMarker: string;
  brushNeon: string;
  brushEraser: string;
  /** Draw tool size-slider label. */
  drawSize: string;
  /** Draw tool "remove all strokes" button. */
  clearDrawing: string;
  /** Focus (selective blur) tool tab label. */
  focus: string;
  /** Focus mode chips. */
  focusOff: string;
  focusRadial: string;
  focusLinear: string;
  /** Focus blur-strength slider label. */
  focusIntensity: string;
  /** Muted hint shown in the Focus panel while mode is Off. */
  focusHint: string;
  crop: string;
  rotate: string;
  straighten: string;
  play: string;
  pause: string;
  flip: string;
  reset: string;
  resetAll: string;
  apply: string;
  brightness: string;
  contrast: string;
  saturation: string;
  adjExposure: string;
  adjHighlights: string;
  adjShadows: string;
  adjWhites: string;
  adjBlacks: string;
  adjTemperature: string;
  adjTint: string;
  adjVibrance: string;
  adjHue: string;
  adjSharpness: string;
  adjVignette: string;
  adjGrain: string;
  addText: string;
  typeHere: string;
  /** Muted hint in the Text tool drawer explaining the second-tap focus-editor gesture. */
  textFocusHint: string;
  /** Accessibility label for the tap catcher that opens the focus editor. */
  textFocusOpen: string;
  /** Paint-target segmented control — text glyph color. */
  paintTargetText: string;
  /** Paint-target segmented control — background pill color. */
  paintTargetBackground: string;
  remove: string;
  duplicate: string;
  bringForward: string;
  sendBackward: string;
  original: string;
  free: string;
  bold: string;
  italic: string;
  customColor: string;
  textAlignment: string;
  textAlignLeft: string;
  textAlignCenter: string;
  textAlignRight: string;
  textBackground: string;
  textBackgroundOn: string;
  textBackgroundOff: string;
  textFont: string;
  hidePanel: string;
  showPanel: string;
  filterIntensity: string;
  filterPackFilm: string;
  filterPackVintage: string;
  filterPackBW: string;
  filterPackWarm: string;
  filterPackCool: string;
  filterPackCinematic: string;
  filterPackVivid: string;
  filterPackPastel: string;
  /** Overlays tool tab label. */
  overlays: string;
  /** Overlays intensity slider label. */
  overlayIntensity: string;
  /** Speed tool tab label + panel heading. */
  speed: string;
  /** Speed fine-grain slider label. */
  speedFine: string;
  /** Built-in overlay pack — light leaks / golden-hour washes. */
  overlayPackLight: string;
  /** Built-in overlay pack — vignette tints / faded looks. */
  overlayPackMood: string;
  stickerPackSmileys: string;
  stickerPackHearts: string;
  stickerPackHands: string;
  stickerPackAnimals: string;
  stickerPackFood: string;
  stickerPackNature: string;
  stickerPackCelebration: string;
  stickerPackSymbols: string;
  loading: string;
  processing: string;
  comingSoon: string;
  undo: string;
  redo: string;
  photoLoadError: string;
  /** AI toolbar tab label. */
  ai: string;
  /** Remove-background row label. */
  removeBackground: string;
  /** Cut-out-subject row label. */
  cutoutSubject: string;
  /** Restore-background row label (undo of removeBackground). */
  restoreBackground: string;
  /** Status label for in-flight AI actions. */
  aiProcessing: string;
  /** Inline error — no subject found. */
  aiNoSubject: string;
  /** Inline error — generic AI failure. */
  aiError: string;
  /** Multi-photo batch "advance" CTA (non-final entry). */
  next: string;
  /** Multi-photo batch position indicator with `{current}` and `{total}` placeholders. */
  photoCounter: string;
  /** Discard-confirm dialog title (multi-mode cancel with edits). */
  discardConfirmTitle: string;
  /** Discard-confirm dialog body. */
  discardConfirmBody: string;
  /** Discard-confirm destructive button. */
  discardConfirmDiscard: string;
  /** Discard-confirm default button. */
  discardConfirmKeep: string;
}

export const en: MediaEditorStrings = {
  cancel: 'Cancel',
  done: 'Done',
  add: 'Add',
  update: 'Update',
  export: 'Export',
  trim: 'Trim',
  setCover: 'Set cover',
  pickCover: 'Pick cover',
  saveCover: 'Save cover',
  editPhoto: 'Edit photo',
  editVideo: 'Edit video',
  filters: 'Filters',
  effects: 'Effects',
  adjust: 'Adjust',
  text: 'Text',
  stickers: 'Stickers',
  draw: 'Draw',
  brushPen: 'Pen',
  brushMarker: 'Marker',
  brushNeon: 'Neon',
  brushEraser: 'Eraser',
  drawSize: 'Size',
  clearDrawing: 'Clear',
  focus: 'Focus',
  focusOff: 'Off',
  focusRadial: 'Radial',
  focusLinear: 'Linear',
  focusIntensity: 'Intensity',
  focusHint: 'Pick Radial or Linear, then drag, pinch or rotate on the photo',
  crop: 'Crop',
  rotate: 'Rotate',
  straighten: 'Straighten',
  play: 'Play',
  pause: 'Pause',
  flip: 'Flip',
  reset: 'Reset',
  resetAll: 'Reset all',
  apply: 'Apply',
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  adjExposure: 'Exposure',
  adjHighlights: 'Highlights',
  adjShadows: 'Shadows',
  adjWhites: 'Whites',
  adjBlacks: 'Blacks',
  adjTemperature: 'Temperature',
  adjTint: 'Tint',
  adjVibrance: 'Vibrance',
  adjHue: 'Hue',
  adjSharpness: 'Sharpness',
  adjVignette: 'Vignette',
  adjGrain: 'Grain',
  addText: 'Add text',
  typeHere: 'Type here…',
  textFocusHint: 'Tap a selected text to edit',
  textFocusOpen: 'Edit text',
  paintTargetText: 'Text',
  paintTargetBackground: 'Background',
  remove: 'Remove',
  duplicate: 'Duplicate',
  bringForward: 'Bring forward',
  sendBackward: 'Send backward',
  original: 'Original',
  free: 'Free',
  bold: 'Bold',
  italic: 'Italic',
  customColor: 'Custom color',
  textAlignment: 'Alignment',
  textAlignLeft: 'Align left',
  textAlignCenter: 'Align center',
  textAlignRight: 'Align right',
  textBackground: 'Background',
  textBackgroundOn: 'Background on',
  textBackgroundOff: 'Background off',
  textFont: 'Font',
  hidePanel: 'Hide panel',
  showPanel: 'Show panel',
  filterIntensity: 'Intensity',
  filterPackFilm: 'Film',
  filterPackVintage: 'Vintage',
  filterPackBW: 'B&W',
  filterPackWarm: 'Warm',
  filterPackCool: 'Cool',
  filterPackCinematic: 'Cinematic',
  filterPackVivid: 'Vivid',
  filterPackPastel: 'Pastel',
  overlays: 'Overlays',
  overlayIntensity: 'Intensity',
  speed: 'Speed',
  speedFine: 'Fine',
  overlayPackLight: 'Light',
  overlayPackMood: 'Mood',
  stickerPackSmileys: 'Smileys',
  stickerPackHearts: 'Hearts',
  stickerPackHands: 'Hands',
  stickerPackAnimals: 'Animals',
  stickerPackFood: 'Food',
  stickerPackNature: 'Nature',
  stickerPackCelebration: 'Party',
  stickerPackSymbols: 'Symbols',
  loading: 'Loading…',
  processing: 'Processing…',
  comingSoon: 'Coming soon',
  undo: 'Undo',
  redo: 'Redo',
  photoLoadError: 'Unable to load photo',
  ai: 'AI',
  removeBackground: 'Remove background',
  cutoutSubject: 'Cut out subject',
  restoreBackground: 'Restore background',
  aiProcessing: 'Processing…',
  aiNoSubject: 'No subject found',
  aiError: 'Something went wrong',
  next: 'Next',
  photoCounter: '{current} / {total}',
  discardConfirmTitle: 'Discard edits?',
  discardConfirmBody: 'You have unsaved edits. Discard and close?',
  discardConfirmDiscard: 'Discard',
  discardConfirmKeep: 'Keep editing',
};

export const ar: MediaEditorStrings = {
  cancel: 'إلغاء',
  done: 'تم',
  add: 'إضافة',
  update: 'تحديث',
  export: 'تصدير',
  trim: 'قص',
  setCover: 'تعيين كغلاف',
  pickCover: 'اختر الغلاف',
  saveCover: 'حفظ الغلاف',
  editPhoto: 'تعديل الصورة',
  editVideo: 'تعديل الفيديو',
  filters: 'فلاتر',
  effects: 'تأثيرات',
  adjust: 'ضبط',
  text: 'نص',
  stickers: 'ملصقات',
  draw: 'رسم',
  brushPen: 'قلم',
  brushMarker: 'قلم تحديد',
  brushNeon: 'نيون',
  brushEraser: 'ممحاة',
  drawSize: 'الحجم',
  clearDrawing: 'مسح',
  focus: 'تركيز',
  focusOff: 'إيقاف',
  focusRadial: 'دائري',
  focusLinear: 'خطي',
  focusIntensity: 'الشدة',
  focusHint: 'اختر دائري أو خطي، ثم اسحب أو قرّب أو أدر على الصورة',
  crop: 'اقتصاص',
  rotate: 'تدوير',
  straighten: 'تعديل الميل',
  play: 'تشغيل',
  pause: 'إيقاف مؤقت',
  flip: 'قلب',
  reset: 'إعادة تعيين',
  resetAll: 'إعادة تعيين الكل',
  apply: 'تطبيق',
  brightness: 'السطوع',
  contrast: 'التباين',
  saturation: 'التشبع',
  adjExposure: 'التعريض الضوئي',
  adjHighlights: 'الإضاءات',
  adjShadows: 'الظلال',
  adjWhites: 'البياض',
  adjBlacks: 'السواد',
  adjTemperature: 'الحرارة',
  adjTint: 'الصبغة',
  adjVibrance: 'الحيوية',
  adjHue: 'تدرج اللون',
  adjSharpness: 'الحدة',
  adjVignette: 'تظليل الحواف',
  adjGrain: 'الحبيبات',
  addText: 'إضافة نص',
  typeHere: 'اكتب هنا…',
  textFocusHint: 'اضغط على نص محدد لتحريره',
  textFocusOpen: 'تحرير النص',
  paintTargetText: 'النص',
  paintTargetBackground: 'الخلفية',
  remove: 'إزالة',
  duplicate: 'تكرار',
  bringForward: 'إحضار للأمام',
  sendBackward: 'إرسال للخلف',
  original: 'الأصل',
  free: 'حر',
  bold: 'عريض',
  italic: 'مائل',
  customColor: 'لون مخصص',
  textAlignment: 'المحاذاة',
  textAlignLeft: 'محاذاة لليسار',
  textAlignCenter: 'توسيط',
  textAlignRight: 'محاذاة لليمين',
  textBackground: 'الخلفية',
  textBackgroundOn: 'تفعيل الخلفية',
  textBackgroundOff: 'إيقاف الخلفية',
  textFont: 'الخط',
  hidePanel: 'إخفاء اللوحة',
  showPanel: 'إظهار اللوحة',
  filterIntensity: 'الشدة',
  filterPackFilm: 'فيلم',
  filterPackVintage: 'كلاسيكي',
  filterPackBW: 'أبيض وأسود',
  filterPackWarm: 'دافئ',
  filterPackCool: 'بارد',
  filterPackCinematic: 'سينمائي',
  filterPackVivid: 'زاهي',
  filterPackPastel: 'باستيل',
  overlays: 'طبقات',
  overlayIntensity: 'الشدة',
  speed: 'السرعة',
  speedFine: 'ضبط دقيق',
  overlayPackLight: 'إضاءة',
  overlayPackMood: 'أجواء',
  stickerPackSmileys: 'وجوه',
  stickerPackHearts: 'قلوب',
  stickerPackHands: 'أيادٍ',
  stickerPackAnimals: 'حيوانات',
  stickerPackFood: 'طعام',
  stickerPackNature: 'طبيعة',
  stickerPackCelebration: 'احتفال',
  stickerPackSymbols: 'رموز',
  loading: 'جارٍ التحميل…',
  processing: 'جارٍ المعالجة…',
  comingSoon: 'قريباً',
  undo: 'تراجع',
  redo: 'إعادة',
  photoLoadError: 'تعذر تحميل الصورة',
  ai: 'AI',
  removeBackground: 'إزالة الخلفية',
  cutoutSubject: 'قص الموضوع',
  restoreBackground: 'استعادة الخلفية',
  aiProcessing: 'جارٍ المعالجة…',
  aiNoSubject: 'لم يتم العثور على موضوع',
  aiError: 'حدث خطأ ما',
  next: 'التالي',
  photoCounter: '{current} / {total}',
  discardConfirmTitle: 'تجاهل التعديلات؟',
  discardConfirmBody: 'لديك تعديلات غير محفوظة. هل تريد تجاهلها والإغلاق؟',
  discardConfirmDiscard: 'تجاهل',
  discardConfirmKeep: 'متابعة التعديل',
};

export const builtInStrings: Record<string, MediaEditorStrings> = { en, ar };
