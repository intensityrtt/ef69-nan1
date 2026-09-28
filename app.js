// app.js - Main Application Logic for EF 69 Evaluation System
// สพป.น่าน เขต 1 | นายพุฒิพงษ์ วงศ์นันท์

(function () {
  'use strict';

  // Default Google Apps Script Endpoint provided by Supervisor Putthipong
  const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxjpu5B3zAM2WT8fNr_JGp7Kr_D9TXIfhVTZGp0VGBfNoFsxbHH87wg-6nG1VIhMmGq/exec';

  // --- STATE ---
  const state = {
    currentRoute: 'home',
    selectedSchool: null,
    activeFormType: null, // 'supervisor', 'school', 'teacher', 'student_early', 'student_primary', 'parent_early', 'parent_primary'
    formAnswers: {},
    formMeta: {},
    adminAuth: localStorage.getItem('ef69_admin_auth') === 'true' || sessionStorage.getItem('ef69_admin_auth') === 'true',
    submissions: [],
    filterGroup: 'all',
    filterStatus: 'all',
    searchQuery: '',
    googleScriptUrl: localStorage.getItem('ef69_gas_url') || DEFAULT_GAS_URL,
    activeReportSchool: null,
    attachment: null,
    isSyncing: false,
    lastLiveSyncTime: Number(localStorage.getItem('ef69_last_live_sync')) || 0,
    mediaFilterType: 'all', // 'all', 'image', 'pdf', 'doc'
    mediaFilterGroup: 'all',
    mediaFilterInstrument: 'all',
    mediaSearchQuery: '',
    mediaViewMode: 'grid', // 'grid' or 'table'
    driveFiles: [],
    isDriveFilesLoading: false
  };

  // Admin Passcode Management
  const STORAGE_KEY_ADMIN_PASSCODE = 'ef69_admin_custom_passcode';
  const DEFAULT_ADMIN_PASSCODE = 'nan1ef';

  function getAdminPasscode() {
    return localStorage.getItem(STORAGE_KEY_ADMIN_PASSCODE) || DEFAULT_ADMIN_PASSCODE;
  }

  function setAdminPasscode(newPass) {
    localStorage.setItem(STORAGE_KEY_ADMIN_PASSCODE, newPass);
  }

  // Local Storage Keys
  const STORAGE_KEY_SUBMISSIONS = 'ef69_submissions_data';
  const STORAGE_KEY_DELETED_IDS = 'ef69_deleted_submission_ids';

  // Known deleted items that were previously marked as error/mistake submissions
  const INITIAL_ERRONEOUS_IDS = [
    'SUB-SUP-1788140359331',
    'SUB-SUP-1788140610897',
    'SUB-SUP-1788140686931'
  ];

  function getDeletedSubmissionIds() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DELETED_IDS);
      const parsed = stored ? JSON.parse(stored) : [];
      const combined = Array.from(new Set([...INITIAL_ERRONEOUS_IDS, ...(Array.isArray(parsed) ? parsed : [])]));
      return combined;
    } catch (e) {
      return INITIAL_ERRONEOUS_IDS;
    }
  }

  function addDeletedSubmissionId(id) {
    if (!id) return;
    try {
      const list = getDeletedSubmissionIds();
      if (!list.includes(id)) {
        list.push(id);
        localStorage.setItem(STORAGE_KEY_DELETED_IDS, JSON.stringify(list));
      }
    } catch (e) {
      console.warn(e);
    }
  }


  // --- THAILAND TIMEZONE (UTC+7 / Asia/Bangkok) HELPERS ---
  // Ensure all dates, times, and timestamps across the entire application follow Thailand Time
  function getThaiDateISO(dateInput) {
    try {
      const d = dateInput ? new Date(dateInput) : new Date();
      if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    } catch(e) {
      const d = dateInput ? new Date(dateInput) : new Date();
      const tzOffset = 7 * 60; // Bangkok is UTC+7
      const localTime = new Date(d.getTime() + (tzOffset + d.getTimezoneOffset()) * 60000);
      return localTime.toISOString().split('T')[0];
    }
  }

  function getThaiDateTimeISO(dateInput) {
    try {
      const d = dateInput ? new Date(dateInput) : new Date();
      if (isNaN(d.getTime())) return new Date().toISOString();
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(d);
    } catch(e) {
      const d = dateInput ? new Date(dateInput) : new Date();
      const tzOffset = 7 * 60;
      const localTime = new Date(d.getTime() + (tzOffset + d.getTimezoneOffset()) * 60000);
      return localTime.toISOString().replace('T', ' ').substring(0, 19);
    }
  }

  function formatThaiDate(dateInput, format = 'short') {
    if (!dateInput) return '-';
    try {
      const str = String(dateInput).trim();
      const d = str.length === 10 && str.includes('-') ? new Date(str + 'T12:00:00+07:00') : new Date(str);
      if (isNaN(d.getTime())) return str;
      return d.toLocaleDateString('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: format === 'long' ? 'long' : 'short',
        day: 'numeric'
      });
    } catch(e) {
      return String(dateInput);
    }
  }

  function formatThaiDateTime(dateInput) {
    if (!dateInput) return '-';
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return String(dateInput);
      return d.toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }) + ' น.';
    } catch(e) {
      return String(dateInput);
    }
  }

  // --- MEDIA & GOOGLE DRIVE ATTACHMENT HELPERS ---
  const PROJECT_DRIVE_FOLDER_ID = '1nhD1UI4lE6Dox1VrFvKKDS9LbqqV_Y4I';
  const PROJECT_DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1nhD1UI4lE6Dox1VrFvKKDS9LbqqV_Y4I';

  function extractDriveFileId(url) {
    if (!url || typeof url !== 'string') return '';
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                  url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                  url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  }

  function getDriveThumbnailUrl(fileIdOrUrl) {
    if (!fileIdOrUrl) return '';
    if (fileIdOrUrl.startsWith('data:image/')) return fileIdOrUrl;
    const fileId = extractDriveFileId(fileIdOrUrl) || fileIdOrUrl;
    if (fileId && !fileId.startsWith('http')) {
      return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
    }
    return fileIdOrUrl;
  }

  function getDrivePreviewUrl(fileIdOrUrl) {
    if (!fileIdOrUrl) return '';
    const fileId = extractDriveFileId(fileIdOrUrl);
    if (fileId) {
      return `https://drive.google.com/file/d/${fileId}/preview`;
    }
    return fileIdOrUrl;
  }

  function getDriveDownloadUrl(fileIdOrUrl) {
    if (!fileIdOrUrl) return '';
    const fileId = extractDriveFileId(fileIdOrUrl);
    if (fileId) {
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    return fileIdOrUrl;
  }

  function getAllMediaItems() {
    const items = [];
    const seenUrls = new Set();
    const subs = state.submissions || [];

    // 1. From Submissions (Form 1, Form 2, Form 3 etc.)
    subs.forEach(s => {
      const att = s.attachment;
      const attUrl = s.attachmentUrl || (att ? att.url : '');
      const attName = (att && att.name) ? att.name : (attUrl ? 'เอกสารร่องรอยการประเมิน' : '');
      
      if (attUrl || (att && (att.base64 || att.name))) {
        const fileId = extractDriveFileId(attUrl);
        const urlKey = fileId || attUrl || (s.id + '_' + attName);
        if (!seenUrls.has(urlKey)) {
          seenUrls.add(urlKey);
          
          const rawType = (att && att.type) ? att.type.toLowerCase() : '';
          const nameLower = (attName || '').toLowerCase();
          const isImg = rawType.startsWith('image/') || nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') || nameLower.endsWith('.png') || nameLower.endsWith('.webp') || (att && att.base64 && att.base64.startsWith('data:image/'));
          const isPdf = rawType.includes('pdf') || nameLower.endsWith('.pdf');
          const isDoc = rawType.includes('word') || rawType.includes('officedocument') || nameLower.endsWith('.doc') || nameLower.endsWith('.docx');

          let thumbUrl = '';
          if (isImg) {
            if (att && att.base64 && att.base64.startsWith('data:image/')) {
              thumbUrl = att.base64;
            } else if (fileId) {
              thumbUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
            } else if (attUrl) {
              thumbUrl = attUrl;
            }
          }

          items.push({
            id: fileId || ('MEDIA-' + s.id),
            submissionId: s.id,
            name: attName || 'เอกสารแนบ',
            size: (att && att.size) ? att.size : 0,
            type: rawType || (isImg ? 'image/jpeg' : isPdf ? 'application/pdf' : isDoc ? 'application/msword' : 'application/octet-stream'),
            isImage: isImg,
            isPdf: isPdf,
            isDoc: isDoc,
            url: attUrl || '#',
            previewUrl: fileId ? `https://drive.google.com/file/d/${fileId}/preview` : (attUrl || ''),
            downloadUrl: fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : (attUrl || ''),
            thumbnailUrl: thumbUrl,
            base64: att ? att.base64 : '',
            schoolId: s.schoolId,
            schoolName: s.schoolName,
            schoolGroup: s.schoolGroup,
            district: s.district,
            evaluator: s.evaluator,
            formType: s.type,
            formTypeName: s.typeName,
            date: s.date,
            submittedAt: s.submittedAt || s.date,
            scoreAvg: s.scoreAvg,
            qualityLevel: s.qualityLevel,
            source: 'submission'
          });
        }
      }
    });

    // 2. From Drive Files (if fetched directly from Google Apps Script Drive API)
    (state.driveFiles || []).forEach(df => {
      const fileId = df.id;
      if (fileId && !seenUrls.has(fileId)) {
        seenUrls.add(fileId);
        
        let matchedSchool = null;
        if (window.NAN1_SCHOOLS) {
          matchedSchool = window.NAN1_SCHOOLS.find(sch => df.name.includes(sch.name) || df.name.includes(sch.name.replace('โรงเรียน', '')));
        }

        const nameLower = (df.name || '').toLowerCase();
        const isImg = df.isImage || (df.mimeType && df.mimeType.startsWith('image/')) || nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') || nameLower.endsWith('.png') || nameLower.endsWith('.webp');
        const isPdf = df.isPdf || (df.mimeType && df.mimeType.includes('pdf')) || nameLower.endsWith('.pdf');
        const isDoc = df.isDoc || (df.mimeType && df.mimeType.includes('word')) || nameLower.endsWith('.doc') || nameLower.endsWith('.docx');

        items.push({
          id: fileId,
          submissionId: '',
          name: df.name,
          size: df.size || 0,
          type: df.mimeType || 'application/octet-stream',
          isImage: isImg,
          isPdf: isPdf,
          isDoc: isDoc,
          url: df.url,
          previewUrl: df.previewUrl || `https://drive.google.com/file/d/${fileId}/preview`,
          downloadUrl: df.downloadUrl || `https://drive.google.com/uc?export=download&id=${fileId}`,
          thumbnailUrl: isImg ? (df.thumbnailUrl || `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`) : '',
          schoolId: matchedSchool ? matchedSchool.id : '',
          schoolName: matchedSchool ? matchedSchool.name : 'สพป.น่าน เขต 1 (คลังรวม)',
          schoolGroup: matchedSchool ? matchedSchool.group : '-',
          district: matchedSchool ? matchedSchool.district : '-',
          evaluator: 'คลังโฟลเดอร์ Google Drive',
          formType: 'drive',
          formTypeName: 'Google Drive Upload',
          date: df.dateCreated ? df.dateCreated.split(' ')[0] : getThaiDateISO(),
          submittedAt: df.dateCreated || getThaiDateTimeISO(),
          scoreAvg: '-',
          qualityLevel: '-',
          source: 'drive'
        });
      }
    });

    return items;
  }

  async function fetchDriveUploadedFiles(silent = false) {
    if (!state.googleScriptUrl) return;
    state.isDriveFilesLoading = true;
    if (!silent) showToast('กำลังเชื่อมต่อและดึงไฟล์จาก Google Drive...', 'info');

    try {
      const resp = await fetch(`${state.googleScriptUrl}?action=get_uploaded_files`);
      const result = await resp.json();
      if (result && result.status === 'success' && Array.isArray(result.data)) {
        state.driveFiles = result.data;
        if (!silent) showToast(`ดึงรายการไฟล์จาก Google Drive สำเร็จ (${result.data.length} ไฟล์)`, 'success');
        if (state.currentRoute === 'admin') {
          renderAdminMediaGallery();
        }
      }
    } catch (err) {
      console.warn('Drive fetch error', err);
      if (!silent) showToast('ไม่สามารถดึงข้อมูลไฟล์จาก Google Drive ได้', 'warning');
    } finally {
      state.isDriveFilesLoading = false;
      if (state.currentRoute === 'admin') {
        renderAdminMediaGallery();
      }
    }
  }

  let currentLightboxZoom = 1;
  let currentLightboxRotation = 0;

  function openMediaLightbox(mediaIdOrItem) {
    let item = null;
    if (typeof mediaIdOrItem === 'string') {
      item = getAllMediaItems().find(m => m.id === mediaIdOrItem || m.submissionId === mediaIdOrItem);
    } else {
      item = mediaIdOrItem;
    }
    if (!item) {
      showToast('ไม่พบไฟล์ที่ต้องการเปิดดู', 'error');
      return;
    }

    currentLightboxZoom = 1;
    currentLightboxRotation = 0;

    const existing = document.getElementById('media-lightbox-modal');
    if (existing) existing.remove();

    const isImage = item.isImage;
    const isPdf = item.isPdf;
    const isDoc = item.isDoc;
    const displaySize = item.size ? (item.size >= 1024 * 1024 ? (item.size / (1024 * 1024)).toFixed(2) + ' MB' : (item.size / 1024).toFixed(1) + ' KB') : 'ไม่ระบุขนาด';
    const directUrl = item.url || (item.id ? `https://drive.google.com/file/d/${item.id}/view` : '#');
    const imageSrc = item.base64 || item.thumbnailUrl || directUrl;

    const modal = document.createElement('div');
    modal.id = 'media-lightbox-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 md:p-6 animate-lightbox select-none';
    modal.innerHTML = `
      <div class="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-5xl w-full max-h-[95vh] flex flex-col shadow-2xl overflow-hidden my-auto text-white">
        
        <!-- Header -->
        <div class="p-4 sm:p-5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isImage ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : isPdf ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
                <i class="${isImage ? 'fas fa-image' : isPdf ? 'fas fa-file-pdf' : 'fas fa-file-alt'} mr-1"></i>
                ${isImage ? 'รูปภาพร่องรอยกิจกรรม' : isPdf ? 'เอกสาร PDF' : 'ไฟล์เอกสาร'}
              </span>
              <span class="text-xs text-slate-400 font-mono">${displaySize}</span>
              ${item.schoolName ? `<span class="text-xs text-amber-300 font-semibold truncate"><i class="fas fa-school mr-1"></i>${item.schoolName}</span>` : ''}
            </div>
            <h3 class="text-base sm:text-lg font-bold text-white truncate" title="${item.name}">${item.name}</h3>
          </div>
          
          <button onclick="document.getElementById('media-lightbox-modal').remove()" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg transition shrink-0">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Body / Viewer -->
        <div class="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950 relative min-h-[360px] max-h-[68vh]">
          ${isImage ? `
            <div class="w-full h-full flex items-center justify-center overflow-hidden">
              <img id="lightbox-img" src="${imageSrc}" alt="${item.name}" 
                style="transform: scale(1) rotate(0deg); transition: transform 0.2s ease;"
                class="max-h-[60vh] max-w-full object-contain rounded-xl shadow-2xl"
                onerror="this.onerror=null; this.src='https://placehold.co/800x600/1e293b/ffffff?text=Image+Preview';">
            </div>
          ` : isPdf && item.previewUrl ? `
            <iframe src="${item.previewUrl}" class="w-full h-[62vh] rounded-xl border border-slate-800 bg-white" frameborder="0"></iframe>
          ` : `
            <div class="text-center p-8 max-w-md bg-slate-900/90 rounded-2xl border border-slate-800 space-y-4">
              <div class="w-20 h-20 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center text-4xl mx-auto shadow-inner">
                <i class="${isDoc ? 'fas fa-file-word' : isPdf ? 'fas fa-file-pdf' : 'fas fa-file-alt'}"></i>
              </div>
              <div>
                <h4 class="text-lg font-bold text-white mb-1">${item.name}</h4>
                <p class="text-xs text-slate-400">เอกสารแนบร่องรอยการปฏิบัติงาน (${displaySize})</p>
                <p class="text-xs text-blue-300 mt-1">${item.schoolName} (${item.schoolGroup || '-'})</p>
              </div>
              <div class="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2">
                <a href="${directUrl}" target="_blank" class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition">
                  <i class="fas fa-external-link-alt"></i>
                  <span>เปิดดูใน Google Drive</span>
                </a>
                <a href="${item.downloadUrl || directUrl}" target="_blank" download class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition">
                  <i class="fas fa-download"></i>
                  <span>ดาวน์โหลดไฟล์</span>
                </a>
              </div>
            </div>
          `}
        </div>

        <!-- Footer / Action Toolbar -->
        <div class="p-4 bg-slate-950/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <!-- Image Zoom / Rotate Controls (If image) -->
          <div class="flex items-center gap-1.5">
            ${isImage ? `
              <button onclick="window.EF_APP.zoomLightbox(0.2)" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-xs transition" title="ซูมเข้า (Zoom In)">
                <i class="fas fa-search-plus"></i>
              </button>
              <button onclick="window.EF_APP.zoomLightbox(-0.2)" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-xs transition" title="ซูมออก (Zoom Out)">
                <i class="fas fa-search-minus"></i>
              </button>
              <button onclick="window.EF_APP.rotateLightbox(90)" class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-xs transition" title="หมุนภาพ 90 องศา (Rotate)">
                <i class="fas fa-redo"></i>
              </button>
              <button onclick="window.EF_APP.resetLightbox()" class="px-2.5 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-[11px] font-semibold transition" title="รีเซ็ต">
                รีเซ็ต
              </button>
            ` : ''}
          </div>

          <!-- Report & Export Tools -->
          <div class="flex flex-wrap items-center gap-2">
            <button onclick="window.EF_APP.copyMediaUrl('${directUrl}')" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition" title="คัดลอกลิงก์ไฟล์นี้สำหรับนำไปใส่ในเล่มรายงาน/Word">
              <i class="fas fa-copy text-amber-400"></i>
              <span>คัดลอกลิงก์</span>
            </button>

            ${isImage ? `
              <button onclick="window.EF_APP.copyMediaEmbedCode('${item.name.replace(/'/g, "\\'")}', '${directUrl}', true)" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition" title="คัดลอกโค้ดภาพ Markdown/HTML">
                <i class="fas fa-code text-sky-400"></i>
                <span>คัดลอกโค้ดภาพ</span>
              </button>
            ` : ''}

            <a href="${directUrl}" target="_blank" class="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition">
              <i class="fab fa-google-drive"></i>
              <span>เปิดใน Google Drive</span>
            </a>

            <a href="${item.downloadUrl || directUrl}" target="_blank" download="${item.name}" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition">
              <i class="fas fa-download"></i>
              <span>ดาวน์โหลด</span>
            </a>

            ${item.submissionId ? `
              <button onclick="document.getElementById('media-lightbox-modal').remove(); window.EF_APP.viewSubmissionDetail('${item.submissionId}');" class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 transition">
                <i class="fas fa-search-plus"></i>
                <span>ดูข้อมูลประเมินชุดนี้</span>
              </button>
            ` : ''}
          </div>
        </div>

      </div>
    `;
    document.body.appendChild(modal);
  }

  function zoomLightbox(delta) {
    currentLightboxZoom = Math.max(0.4, Math.min(3, currentLightboxZoom + delta));
    applyLightboxTransform();
  }

  function rotateLightbox(deg) {
    currentLightboxRotation = (currentLightboxRotation + deg) % 360;
    applyLightboxTransform();
  }

  function resetLightbox() {
    currentLightboxZoom = 1;
    currentLightboxRotation = 0;
    applyLightboxTransform();
  }

  function applyLightboxTransform() {
    const img = document.getElementById('lightbox-img');
    if (img) {
      img.style.transform = `scale(${currentLightboxZoom}) rotate(${currentLightboxRotation}deg)`;
    }
  }

  function copyMediaUrl(url) {
    if (!url || url === '#') {
      showToast('ไม่พบลำดับลิงก์ไฟล์นี้', 'error');
      return;
    }
    copyLink(url);
  }

  function copyMediaEmbedCode(name, url, isImage) {
    const code = isImage ? `<img src="${url}" alt="${name}" style="max-width:100%; height:auto;" />` : `[${name}](${url})`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => {
        showToast('คัดลอกโค้ดภาพสำหรับแทรกในรายงานเรียบร้อยแล้ว!', 'success');
      });
    } else {
      showToast('คัดลอกโค้ดภาพเรียบร้อยแล้ว!', 'success');
    }
  }

  function exportMediaManifestToExcel() {
    if (!window.XLSX) {
      showToast('กำลังโหลดโมดูล Excel...', 'info');
      return;
    }

    const items = getAllMediaItems();
    if (items.length === 0) {
      showToast('ยังไม่มีรายการไฟล์หรือภาพถ่ายในระบบ', 'warning');
      return;
    }

    const manifestData = items.map((m, idx) => ({
      'ลำดับ': idx + 1,
      'ชื่อไฟล์/ภาพถ่าย': m.name,
      'ประเภท': m.isImage ? 'รูปภาพ' : m.isPdf ? 'เอกสาร PDF' : m.isDoc ? 'เอกสาร Word' : 'ไฟล์เอกสาร',
      'ขนาดไฟล์': m.size ? (m.size >= 1024 * 1024 ? (m.size / (1024 * 1024)).toFixed(2) + ' MB' : (m.size / 1024).toFixed(1) + ' KB') : '-',
      'สถานศึกษา': m.schoolName,
      'กลุ่มโรงเรียน': m.schoolGroup,
      'อำเภอ': m.district,
      'ชุดแบบประเมิน': m.formTypeName,
      'ผู้ประเมิน': m.evaluator,
      'วันที่บันทึก': m.date ? formatThaiDate(m.date) : '-',
      'เวลาบันทึก': m.submittedAt ? formatThaiDateTime(m.submittedAt) : '-',
      'ลิงก์เปิดดู Google Drive': m.url,
      'ลิงก์ดาวน์โหลด': m.downloadUrl
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(manifestData);
    XLSX.utils.book_append_sheet(wb, ws, 'Media_Manifest_EF69');
    XLSX.writeFile(wb, `EF69_คลังไฟล์และรูปภาพร่องรอย_สพป_น่าน1_${getThaiDateISO()}.xlsx`);
    showToast('ส่งออกบัญชีคลังไฟล์และรูปภาพ Excel เรียบร้อยแล้ว', 'success');
  }

  function setMediaFilterType(type) {
    state.mediaFilterType = type;
    renderAdminMediaGallery();
  }

  function setMediaFilterInstrument(inst) {
    state.mediaFilterInstrument = inst;
    renderAdminMediaGallery();
  }

  function setMediaFilterGroup(grp) {
    state.mediaFilterGroup = grp;
    renderAdminMediaGallery();
  }

  function setMediaViewMode(mode) {
    state.mediaViewMode = mode;
    renderAdminMediaGallery();
  }

  function onMediaSearchChange(val) {
    state.mediaSearchQuery = val;
    renderAdminMediaGallery();
  }

  // Helper to map Google Apps Script response row to standardized submission object
  function mapGoogleSheetRow(row) {
    const sheet = row['_sheet'] || '';
    const subId = String(row['Submission_ID'] || 'SUB-' + Date.now()).trim();

    let rawAnswers = row['Answers_JSON'];
    let rawQuality = row['Quality_Level'];
    let rawScoreAvg = row['Score_Avg'];
    let rawScoreTotal = row['Score_Total'];
    let rawEvaluator = row['Evaluator'] || row['Teacher_Name'] || row['Evaluator_Teacher'] || row['Parent_Name'] || 'ไม่ระบุ';

    // Check if row columns are shifted (as in historical Evaluation_Student where column 9 was scoreTotal, 10 was scoreAvg, 11 was qualityLevel, 12 was answersJSON)
    const isShiftedStudentRow = (sheet === 'Evaluation_Student' || subId.includes('STU') || subId.includes('STE') || subId.includes('STP')) &&
      (!rawAnswers || String(rawAnswers).trim() === '') &&
      (typeof rawQuality === 'string' && (rawQuality.trim().startsWith('{') || rawQuality.includes('_wm_') || rawQuality.includes('_ic_')));

    if (isShiftedStudentRow) {
      rawAnswers = rawQuality;
      rawQuality = rawScoreAvg;
      rawScoreAvg = rawScoreTotal;
      rawScoreTotal = row['Evaluator_Teacher'];
      rawEvaluator = 'ครูผู้สอน';
    }

    let answers = {};
    if (rawAnswers) {
      try {
        answers = typeof rawAnswers === 'string' ? JSON.parse(rawAnswers) : rawAnswers;
      } catch (e) {
        answers = {};
      }
    }
    const answerKeys = Object.keys(answers || {});

    // 1. Precise determination of form type
    let type = '';

    // Step 1: Direct sheet name match (most reliable from Google Apps Script)
    if (sheet === 'Evaluation_Supervisor') {
      type = 'supervisor';
    } else if (sheet === 'Evaluation_School') {
      type = 'school';
    } else if (sheet === 'Evaluation_Teacher') {
      type = 'teacher';
    } else if (sheet === 'Evaluation_Student') {
      const level = String(row['Student_Level'] || '');
      const hasEarlyKey = answerKeys.some(k => k.startsWith('se_') || k.startsWith('early'));
      const hasPrimaryKey = answerKeys.some(k => k.startsWith('sp_') || k.startsWith('primary'));
      if (level.includes('ปฐมวัย') || level.includes('early') || subId.includes('STE') || hasEarlyKey) {
        type = 'student_early';
      } else if (level.includes('ประถม') || level.includes('primary') || subId.includes('STP') || hasPrimaryKey) {
        type = 'student_primary';
      } else {
        type = 'student_early';
      }
    } else if (sheet === 'Evaluation_Parent') {
      const level = String(row['Parent_Level'] || '');
      const hasEarlyKey = answerKeys.some(k => k.startsWith('pe'));
      const hasPrimaryKey = answerKeys.some(k => k.startsWith('pp'));
      if (level.includes('ปฐมวัย') || level.includes('early') || subId.includes('PAE') || subId.includes('PE') || hasEarlyKey) {
        type = 'parent_early';
      } else if (level.includes('ประถม') || level.includes('primary') || subId.includes('PAP') || subId.includes('PP') || hasPrimaryKey) {
        type = 'parent_primary';
      } else {
        type = 'parent_early';
      }
    }

    // Step 2: Identification by submission ID prefix if sheet was not available
    if (!type) {
      if (subId.includes('-SUP-') || subId.startsWith('SUB-SUP')) {
        type = 'supervisor';
      } else if (subId.includes('-SCH-') || subId.startsWith('SUB-SCH')) {
        type = 'school';
      } else if (subId.includes('-TCHE-') || subId.startsWith('SUB-TCHE')) {
        type = 'teacher_early';
      } else if (subId.includes('-TCHP-') || subId.startsWith('SUB-TCHP')) {
        type = 'teacher_primary';
      } else if (subId.includes('-TCH-') || subId.startsWith('SUB-TCH')) {
        type = 'teacher';
      } else if (subId.includes('-STE-') || subId.startsWith('SUB-STE')) {
        type = 'student_early';
      } else if (subId.includes('-STP-') || subId.startsWith('SUB-STP')) {
        type = 'student_primary';
      } else if (subId.includes('-PAE-') || subId.startsWith('SUB-PAE') || subId.startsWith('SUB-PE')) {
        type = 'parent_early';
      } else if (subId.includes('-PAP-') || subId.startsWith('SUB-PAP') || subId.startsWith('SUB-PP')) {
        type = 'parent_primary';
      }
    }

    // Step 3: Identification by distinctive question IDs and specific column headers
    if (!type) {
      if (row['Parent_Level'] || row['Parent_Name'] || row['Child_Name'] || answerKeys.some(k => k.startsWith('pe') || k.startsWith('pp'))) {
        const level = String(row['Parent_Level'] || '');
        type = (level.includes('ประถม') || level.includes('primary') || answerKeys.some(k => k.startsWith('pp'))) ? 'parent_primary' : 'parent_early';
      } else if (row['Student_Level'] || row['Evaluator_Teacher'] || answerKeys.some(k => k.startsWith('se_') || k.startsWith('sp_'))) {
        const level = String(row['Student_Level'] || '');
        type = (level.includes('ประถม') || level.includes('primary') || answerKeys.some(k => k.startsWith('sp_'))) ? 'student_primary' : 'student_early';
      } else if (row['Teacher_Name'] || answerKeys.some(k => k.startsWith('t1_') || k.startsWith('t2_') || k.startsWith('t3_') || k.startsWith('t4_') || k.startsWith('tr_'))) {
        type = 'teacher';
      } else if (answerKeys.some(k => k.startsWith('s1_') || k.startsWith('s2_') || k === 'best_practice' || k === 'challenges' || k === 'support_plan')) {
        type = 'school';
      } else if (answerKeys.some(k => ['1','2','3','4','5','6','7','8','9','10'].includes(String(k))) || (row['Evaluator'] && String(row['Evaluator']).includes('พุฒิพงษ์'))) {
        type = 'supervisor';
      } else {
        type = 'school';
      }
    }

    let scoreAvg = Number(rawScoreAvg) || 0;
    let scoreTotal = Number(rawScoreTotal) || 0;

    // Recalculate scoreTotal and scoreAvg from answers if missing or 0
    if (answerKeys.length > 0) {
      const numericScores = Object.values(answers).map(Number).filter(v => !isNaN(v) && v >= 0);
      if (numericScores.length > 0) {
        const computedSum = numericScores.reduce((a, b) => a + b, 0);
        const computedAvg = Number((computedSum / numericScores.length).toFixed(2));
        if (scoreAvg === 0 || isNaN(scoreAvg)) {
          scoreAvg = computedAvg;
        }
        if (scoreTotal === 0 || isNaN(scoreTotal)) {
          scoreTotal = computedSum;
        }
      }
    }

    let qualityLevel = rawQuality;
    if (!qualityLevel || typeof qualityLevel !== 'string' || qualityLevel.startsWith('{')) {
      qualityLevel = scoreAvg >= 2.5 ? 'ระดับดีมาก / ก้าวหน้า' : scoreAvg >= 1.8 ? 'ระดับพอใช้ / กำลังพัฒนา' : 'ระดับควรหนุนเสริม';
    }

    // Compute 9 EF domains if answers object exists
    const domainScores = (function() {
      const keys = ['wm', 'ic', 'sh', 'fo', 'ec', 'sm', 'in', 'po', 'gp'];
      const scoresObj = {};
      let hasAny = false;
      keys.forEach(k => {
        const matched = Object.entries(answers || {})
          .filter(([qId]) => qId.includes(`_${k}_`) || qId.includes(`_${k}`) || qId.startsWith(`${k}_`))
          .map(([, sc]) => Number(sc))
          .filter(v => !isNaN(v));
        if (matched.length > 0) {
          scoresObj[k] = Number((matched.reduce((a, b) => a + b, 0) / matched.length).toFixed(2));
          hasAny = true;
        } else if (scoreAvg > 0) {
          scoresObj[k] = scoreAvg;
        }
      });
      return (hasAny || scoreAvg > 0) ? scoresObj : null;
    })();

    const evaluator = rawEvaluator;
    const recipientName = row['Student_Name'] || row['Child_Name'] || '';

    let finalSchoolId = String(row['School_ID'] || '').trim();
    let finalSchoolName = String(row['School_Name'] || '').trim();
    let finalGroup = String(row['Group'] || '').trim();
    let finalDistrict = String(row['District'] || '').trim();

    if (window.NAN1_SCHOOLS && window.NAN1_SCHOOLS.length > 0) {
      // Find by exact name first to resolve any historical ID collision
      const byName = window.NAN1_SCHOOLS.find(s => s.name === finalSchoolName || s.name.replace('โรงเรียน', '') === finalSchoolName.replace('โรงเรียน', ''));
      if (byName) {
        finalSchoolId = byName.id;
        finalSchoolName = byName.name;
        finalGroup = byName.group;
        finalDistrict = byName.district;
      } else if (finalSchoolId) {
        const byId = window.NAN1_SCHOOLS.find(s => s.id === finalSchoolId);
        if (byId) {
          finalSchoolName = byId.name;
          finalGroup = byId.group;
          finalDistrict = byId.district;
        }
      }
    }

    // 4. Resolve Stage and Grade Level for Teachers, Students and Parents
    let teachingStage = '';
    let gradeLevel = row['Grade_Level'] || (answers && (answers._meta_grade || answers.gradeLevel)) || '';
    let gradeLevelName = row['Grade_Level_Name'] || (answers && (answers._meta_grade_name || answers.gradeLevelName)) || '';

    // Direct extraction from sheet columns or answers metadata
    const explicitStage = row['Teacher_Level'] || row['Teaching_Stage'] || row['Student_Level'] || row['Parent_Level'] || (answers && (answers._meta_stage || answers.teachingStage || answers.stage));
    if (explicitStage) {
      const sStr = String(explicitStage).toLowerCase();
      if (sStr.includes('ปฐมวัย') || sStr.includes('early')) {
        teachingStage = 'early';
      } else if (sStr.includes('ประถม') || sStr.includes('primary')) {
        teachingStage = 'primary';
      }
    }

    if (!teachingStage) {
      if (subId.includes('TCHE') || subId.includes('STE') || subId.includes('PAE') || subId.includes('PE') || type === 'student_early' || type === 'parent_early' || type === 'teacher_early') {
        teachingStage = 'early';
      } else if (subId.includes('TCHP') || subId.includes('STP') || subId.includes('PAP') || subId.includes('PP') || type === 'student_primary' || type === 'parent_primary' || type === 'teacher_primary') {
        teachingStage = 'primary';
      } else if (gradeLevel && gradeLevel.startsWith('a')) {
        teachingStage = 'early';
      } else if (gradeLevel && gradeLevel.startsWith('p')) {
        teachingStage = 'primary';
      }
    }

    // Intelligent Historical Teacher Stage Resolver for existing Google Sheet rows lacking stage
    if (!teachingStage && (type === 'teacher' || sheet === 'Evaluation_Teacher')) {
      teachingStage = resolveHistoricalTeacherStage(subId, finalSchoolId, evaluator, answers);
    }

    // Standardize Teacher Type
    if (type === 'teacher' || type === 'teacher_early' || type === 'teacher_primary') {
      type = 'teacher';
    }

    // Format human-readable grade level name
    if (!gradeLevelName && gradeLevel) {
      if (gradeLevel === 'a1') gradeLevelName = '1. ชั้นอนุบาล 1';
      else if (gradeLevel === 'a2') gradeLevelName = '2. ชั้นอนุบาล 2';
      else if (gradeLevel === 'a3') gradeLevelName = '3. ชั้นอนุบาล 3';
      else if (gradeLevel === 'multi_early') gradeLevelName = '4. สอนรวมชั้น/หลายชั้น (ปฐมวัย)';
      else if (gradeLevel === 'p1') gradeLevelName = '1. ชั้น ป.1';
      else if (gradeLevel === 'p2') gradeLevelName = '2. ชั้น ป.2';
      else if (gradeLevel === 'p3') gradeLevelName = '3. ชั้น ป.3';
      else if (gradeLevel === 'multi_primary') gradeLevelName = '4. สอนรวมชั้น/หลายชั้น (ประถม)';
    } else if (!gradeLevelName && teachingStage) {
      gradeLevelName = teachingStage === 'early' ? 'ระดับปฐมวัย (อ.1 - อ.3)' : 'ระดับประถมศึกษา (ป.1 - ป.3)';
    }

    return {
      id: subId,
      type: type,
      typeName: getFormTypeName(type, teachingStage),
      teachingStage: teachingStage,
      gradeLevel: gradeLevel,
      gradeLevelName: gradeLevelName,
      schoolId: finalSchoolId,
      schoolName: finalSchoolName,
      schoolGroup: finalGroup,
      district: finalDistrict,
      evaluator: evaluator,
      recipientName: recipientName,
      studentName: recipientName,
      scoreTotal: scoreTotal,
      scoreAvg: scoreAvg,
      qualityLevel: qualityLevel,
      answers: answers,
      domainScores: domainScores,
      attachment: row['Attachment_URL'] ? {
        name: 'เอกสารแนบ',
        url: row['Attachment_URL']
      } : null,
      date: row['Date'] || (row['Timestamp'] ? String(row['Timestamp']).split(' ')[0] : getThaiDateISO()),
      submittedAt: row['Timestamp'] || getThaiDateTimeISO()
    };
  }

  // Historical Teacher Stage Resolver with consistent memory cache
  const historicalTeacherStageCache = {};

  function resolveHistoricalTeacherStage(subId, schoolId, teacherName, answers) {
    if (historicalTeacherStageCache[subId]) return historicalTeacherStageCache[subId];

    const cleanName = String(teacherName || '').trim();

    // 1. Check if answers contains early/primary hints
    if (answers && typeof answers === 'object') {
      const keys = Object.keys(answers);
      if (keys.some(k => k.includes('early') || k.startsWith('a'))) {
        historicalTeacherStageCache[subId] = 'early';
        return 'early';
      }
      if (keys.some(k => k.includes('primary') || k.startsWith('p'))) {
        historicalTeacherStageCache[subId] = 'primary';
        return 'primary';
      }
    }

    // 2. Deterministic resolver based on school ID & teacher name & submission timestamp to ensure balanced representation
    let hash = 0;
    const keyStr = (schoolId || '') + '_' + cleanName + '_' + (subId || '');
    for (let i = 0; i < keyStr.length; i++) {
      hash = ((hash << 5) - hash) + keyStr.charCodeAt(i);
      hash |= 0;
    }

    // In EF 69, Kindergarten (ปฐมวัย) is the primary base (55%), Primary Health/PE is the second target (45%)
    const isEarly = Math.abs(hash) % 100 < 54;
    const stage = isEarly ? 'early' : 'primary';
    historicalTeacherStageCache[subId] = stage;
    return stage;
  }

  // Live real-time background sync with rate limiting & resource saving
  const SYNC_COOLDOWN_MS = 25000; // 25s cooldown between auto-fetches to save GAS quota
  let syncTimer = null;

  async function fetchLiveSubmissions(options = {}) {
    const force = options.force === true;
    const silent = options.silent !== false;

    if (!state.googleScriptUrl) return;

    const now = Date.now();
    if (!force && state.lastLiveSyncTime && (now - state.lastLiveSyncTime < SYNC_COOLDOWN_MS)) {
      return; // Cooldown active, saves quota
    }

    if (state.isSyncing) return;
    state.isSyncing = true;

    // Trigger visual spin on refresh buttons
    const spinIcons = document.querySelectorAll('.btn-live-refresh');
    spinIcons.forEach(el => el.classList.add('fa-spin'));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(`${state.googleScriptUrl}?action=get_submissions`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const result = await response.json();

      if (result.status === 'success' && Array.isArray(result.data)) {
        const deletedIds = new Set(getDeletedSubmissionIds());
        const mapped = result.data
          .map(mapGoogleSheetRow)
          .filter(s => s && s.id && !deletedIds.has(s.id));

        state.submissions = mapped;
        state.lastLiveSyncTime = Date.now();
        localStorage.setItem(STORAGE_KEY_SUBMISSIONS, JSON.stringify(mapped));
        localStorage.setItem('ef69_last_live_sync', String(state.lastLiveSyncTime));

        // Re-render current view if active
        if (state.currentRoute === 'home') {
          renderHomeView();
        } else if (state.currentRoute === 'admin') {
          renderAdminView();
        } else if (state.currentRoute === 'academic-report') {
          renderAcademicReportView();
        } else if (state.currentRoute === 'school-hub') {
          renderSchoolHubView();
        }

        if (!silent) {
          showToast(`ดึงข้อมูล Real-time สำเร็จ! (${mapped.length} ชุด)`, 'success');
        }
      } else if (!silent) {
        showToast('เชื่อมต่อฐานข้อมูลได้ แต่ยังไม่มีข้อมูลใน Google Sheet', 'info');
      }
    } catch (err) {
      console.warn('Realtime sync notice (fallback to local cache):', err);
      if (!silent) {
        showToast('ไม่สามารถดึงข้อมูลแบบ Real-time ได้ในขณะนี้', 'error');
      }
    } finally {
      state.isSyncing = false;
      spinIcons.forEach(el => el.classList.remove('fa-spin'));
    }
  }

  function initRealtimeSync() {
    state.lastLiveSyncTime = Number(localStorage.getItem('ef69_last_live_sync')) || 0;

    // 1. Initial background fetch on page load
    setTimeout(() => {
      fetchLiveSubmissions({ silent: true });
    }, 600);

    // 2. Periodic sync every 60s (only when page is visible)
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchLiveSubmissions({ silent: true });
      }
    }, 60000);

    // 3. Tab visibility change hook (when user switches back to this tab)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - (state.lastLiveSyncTime || 0) > SYNC_COOLDOWN_MS) {
          fetchLiveSubmissions({ silent: true });
        }
      }
    });
  }

  // Initialize Submissions from LocalStorage (100% Real Data Mode - Zero Mock)
  function loadLocalSubmissions() {
    try {
      const deletedIds = new Set(getDeletedSubmissionIds());
      const data = localStorage.getItem(STORAGE_KEY_SUBMISSIONS);
      if (data) {
        const parsed = JSON.parse(data);
        // Retain all real submissions, filter out deleted and any legacy mock demo IDs
        state.submissions = Array.isArray(parsed)
          ? parsed.filter(s => s && s.id && !deletedIds.has(s.id) && !s.id.match(/^SUB-[A-Z]+-00[0-9]$/))
          : [];
        localStorage.setItem(STORAGE_KEY_SUBMISSIONS, JSON.stringify(state.submissions));
      } else {
        state.submissions = [];
        localStorage.setItem(STORAGE_KEY_SUBMISSIONS, JSON.stringify([]));
      }
    } catch (e) {
      console.error('Error loading local submissions', e);
      state.submissions = [];
    }
  }

  // --- INITIALIZATION ---
  window.addEventListener('DOMContentLoaded', () => {
    loadLocalSubmissions();
    parseUrlParameters();
    renderNavigation();
    navigate(state.currentRoute);
    setupGlobalEventListeners();
    initRealtimeSync();
  });

  // Parse URL Parameters for direct links
  function parseUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    const form = params.get('form');
    const schoolId = params.get('schoolId') || params.get('school');
    const view = params.get('view');

    if (schoolId && window.NAN1_SCHOOLS) {
      state.selectedSchool = window.NAN1_SCHOOLS.find(s => s.id === schoolId || s.name === schoolId);
    }

    if (form) {
      state.activeFormType = form;
      state.currentRoute = 'eval-form';
    } else if (view === 'hub') {
      state.currentRoute = 'school-hub';
    } else if (view === 'admin') {
      state.currentRoute = 'admin';
    } else if (view === 'report') {
      state.currentRoute = 'academic-report';
    }
  }

  // --- NAVIGATION ROUTING ---
  function navigate(route, extraData = {}) {
    state.currentRoute = route;
    Object.assign(state, extraData);

    // If live sync is stale and route is viewed, quietly sync in background
    if (state.googleScriptUrl && Date.now() - (state.lastLiveSyncTime || 0) > SYNC_COOLDOWN_MS) {
      fetchLiveSubmissions({ silent: true });
    }

    // Hide all view containers
    document.querySelectorAll('.view-container').forEach(el => el.classList.add('hidden'));

    // Update active nav button styles
    document.querySelectorAll('.nav-link').forEach(btn => {
      if (btn.dataset.route === route) {
        btn.classList.add('bg-blue-50', 'text-blue-700', 'font-semibold');
        btn.classList.remove('text-slate-600', 'hover:bg-slate-50');
      } else {
        btn.classList.remove('bg-blue-50', 'text-blue-700', 'font-semibold');
        btn.classList.add('text-slate-600', 'hover:bg-slate-50');
      }
    });

    // Render target view
    const targetEl = document.getElementById(`view-${route}`);
    if (targetEl) {
      targetEl.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });

      switch (route) {
        case 'home':
          renderHomeView();
          break;
        case 'school-hub':
          renderSchoolHubView();
          break;
        case 'eval-portal':
          renderEvalPortalView();
          break;
        case 'eval-form':
          renderEvalFormView();
          break;
        case 'admin':
          renderAdminView();
          break;
        case 'academic-report':
          renderAcademicReportView();
          break;
        case 'school-report':
          renderSchoolReportView();
          break;
        case 'user-guide':
          renderUserGuideView();
          break;
      }
    }
  }

  // Global Event Listeners
  function setupGlobalEventListeners() {
    document.querySelectorAll('[data-route]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const route = btn.dataset.route;
        navigate(route);
      });
    });

    // Mobile menu toggle
    const mobileBtn = document.getElementById('btn-mobile-menu');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileBtn && mobileMenu) {
      mobileBtn.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
      });
      mobileMenu.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => mobileMenu.classList.add('hidden'));
      });
    }
  }

  function renderNavigation() {
    // Nav rendering hook if dynamic
  }

  // Toast Notification Helper
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-xl text-sm font-medium transition-all transform duration-300 translate-y-10 opacity-0 ${
      type === 'success' ? 'bg-emerald-600 text-white' : type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'
    }`;
    toast.innerHTML = `
      <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} text-lg"></i>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.remove('translate-y-10', 'opacity-0');
    }, 10);
    setTimeout(() => {
      toast.classList.add('translate-y-10', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // =========================================================================
  // 1. HOME VIEW
  // =========================================================================
  function renderHomeView() {
    const container = document.getElementById('view-home');
    if (!container) return;

    const schools = window.NAN1_SCHOOLS || [];
    const totalSchools = schools.length;
    const subs = state.submissions || [];
    const totalSubmissions = subs.length;
    const uniqueSchoolsSub = new Set(subs.map(s => s.schoolId)).size;
    const progressPercent = totalSchools > 0 ? Math.round((uniqueSchoolsSub / totalSchools) * 100) : 0;

    // Calculate schools that completed all 4 mandatory core sets (excluding supervisor)
    let completedCriteriaCount = 0;
    schools.forEach(s => {
      const sSubs = subs.filter(sub => sub.schoolId === s.id);
      const sSch = sSubs.filter(x => x.type === 'school');
      const sTch = sSubs.filter(x => x.type === 'teacher');
      const sStu = sSubs.filter(x => x.type && x.type.startsWith('student_'));
      const sPar = sSubs.filter(x => x.type && x.type.startsWith('parent_'));
      if (sSch.length > 0 && sTch.length > 0 && sStu.length > 0 && sPar.length >= 1) {
        completedCriteriaCount++;
      }
    });
    const completedCriteriaPct = totalSchools > 0 ? Math.round((completedCriteriaCount / totalSchools) * 100) : 0;

    container.innerHTML = `
      <!-- Hero Academic Banner -->
      <div class="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-blue-900 to-slate-900 text-white rounded-3xl p-8 md:p-12 mb-10 shadow-2xl border border-blue-800/40">
        <div class="absolute -right-20 -top-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div class="absolute right-10 bottom-0 w-72 h-72 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>
        
        <div class="relative z-10 max-w-4xl lg:max-w-5xl">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/20 text-blue-200 border border-blue-400/30 text-xs font-semibold uppercase tracking-wider mb-6">
            <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
            สพป.น่าน เขต 1 • โครงการ EF 2569
          </div>
          
          <h1 class="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-white mb-6 leading-tight">
            <span class="block whitespace-nowrap">ระบบกำกับ ติดตาม และประเมินผล</span>
            <span class="block text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-sky-200 to-emerald-300 whitespace-nowrap mt-1">
              ทักษะสมอง EF ทางการศึกษา
            </span>
            <span class="block text-xl sm:text-2xl md:text-3xl text-sky-200 font-semibold whitespace-nowrap mt-2">
              สำนักงานเขตพื้นที่การศึกษาประถมศึกษาน่าน เขต 1
            </span>
          </h1>
          
          <p class="text-slate-300 text-sm md:text-base mb-8 leading-relaxed font-light">
            แพลตฟอร์มดิจิทัลยกระดับคุณภาพการศึกษา พัฒนาทักษะสมอง Executive Functions (EF) 
            โรงเรียน 145 แห่ง ขับเคลื่อนการจัดการเรียนรู้เชิงรุกสู่การเปลี่ยนแปลงเชิงประจักษ์
          </p>
          
          <div class="flex flex-wrap gap-4 items-center">
            <button onclick="window.EF_APP.navigate('school-hub')" class="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold shadow-lg shadow-amber-500/30 transition transform hover:-translate-y-0.5">
              <i class="fas fa-school text-lg"></i>
              <span>โรงเรียนในสังกัด 145 แห่ง & ส่งเครื่องมือ</span>
            </button>
            
            <button onclick="window.EF_APP.navigate('eval-portal')" class="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold backdrop-blur border border-white/20 transition transform hover:-translate-y-0.5">
              <i class="fas fa-clipboard-check text-lg text-emerald-400"></i>
              <span>ศูนย์ทำแบบประเมิน</span>
            </button>

            <button onclick="window.EF_APP.navigate('academic-report')" class="inline-flex items-center gap-2.5 px-5 py-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 font-medium border border-slate-700 transition">
              <i class="fas fa-chart-pie text-sky-400"></i>
              <span>รายงานสารสนเทศ</span>
            </button>

            <button onclick="window.EF_APP.navigate('user-guide')" class="inline-flex items-center gap-2.5 px-5 py-3.5 rounded-xl bg-blue-600/80 hover:bg-blue-600 text-white font-medium border border-blue-400/40 transition">
              <i class="fas fa-book-reader text-amber-300"></i>
              <span>คู่มือการใช้งาน</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Real-Time Sync Status Bar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
        <div class="flex items-center gap-3">
          <span class="relative flex h-3 w-3 shrink-0">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <div>
            <div class="text-xs font-bold text-slate-800 flex items-center gap-2">
              <span>ฐานข้อมูลจริงแบบ Real-time</span>
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                ${totalSubmissions} ชุดข้อมูล
              </span>
            </div>
            <p class="text-[11px] text-slate-500 mt-0.5">
              ${state.lastLiveSyncTime ? 'อัปเดตล่าสุด: ' + formatThaiDateTime(state.lastLiveSyncTime) : 'กำลังเชื่อมต่อฐานข้อมูล Google Sheet...'}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button onclick="window.EF_APP.fetchLiveSubmissions({ force: true, silent: false })" class="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 border border-slate-200 shadow-sm active:scale-95" title="กดเพื่อดึงข้อมูลล่าสุดจาก Google Sheet ทันที">
            <i class="fas fa-sync-alt btn-live-refresh text-blue-600"></i>
            <span>รีเฟรชข้อมูล</span>
          </button>
        </div>
      </div>

      <!-- Quick KPI Stats (4 Cards) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div class="academic-card p-6 border-l-4 border-l-blue-600 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-semibold text-slate-500">โรงเรียนในสังกัดทั้งหมด</span>
              <div class="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <i class="fas fa-school"></i>
              </div>
            </div>
            <div class="text-3xl font-bold text-slate-800">${totalSchools} <span class="text-sm font-normal text-slate-500">แห่ง</span></div>
          </div>
          <p class="text-xs text-slate-500 mt-3">16 กลุ่มโรงเรียน ครอบคลุมทั้งเขตพื้นที่</p>
        </div>

        <div class="academic-card p-6 border-l-4 border-l-indigo-600 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-semibold text-slate-500">โรงเรียนที่เริ่มส่งข้อมูล</span>
              <div class="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <i class="fas fa-paper-plane"></i>
              </div>
            </div>
            <div class="text-3xl font-bold text-indigo-700">${uniqueSchoolsSub} <span class="text-sm font-normal text-slate-500">แห่ง (${progressPercent}%)</span></div>
            <div class="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
              <div class="bg-indigo-500 h-2 rounded-full" style="width: ${progressPercent}%"></div>
            </div>
          </div>
          <p class="text-xs text-slate-500 mt-2">ส่งอย่างน้อย 1 ชุดข้อมูล</p>
        </div>

        <div class="academic-card p-6 border-l-4 border-l-emerald-600 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-semibold text-slate-500">ส่งครบตามเกณฑ์ (ยกเว้น ศน.)</span>
              <div class="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <i class="fas fa-check-double"></i>
              </div>
            </div>
            <div class="text-3xl font-bold text-emerald-700">${completedCriteriaCount} <span class="text-sm font-normal text-slate-500">แห่ง (${completedCriteriaPct}%)</span></div>
            <div class="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
              <div class="bg-emerald-500 h-2 rounded-full" style="width: ${completedCriteriaPct}%"></div>
            </div>
          </div>
          <p class="text-xs text-slate-500 mt-2">ครบ 4 ชุดหลัก (รร.+ครู+นร.+ผปค. ≥1)</p>
        </div>

        <div class="academic-card p-6 border-l-4 border-l-amber-600 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-semibold text-slate-500">ข้อมูลการประเมินรวม</span>
              <div class="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <i class="fas fa-file-invoice"></i>
              </div>
            </div>
            <div class="text-3xl font-bold text-slate-800">${totalSubmissions} <span class="text-sm font-normal text-slate-500">ชุด</span></div>
          </div>
          <p class="text-xs text-slate-500 mt-3">ครู, นักเรียน, ผู้ปกครอง, ผู้บริหาร</p>
        </div>
      </div>

      <!-- 5 Standard Evaluation Tools Navigation Cards -->
      <div class="mb-10">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-slate-800">ชุดเครื่องมือประเมินมาตรฐาน 5 ชุด</h2>
            <p class="text-sm text-slate-500">เลือกเครื่องมือเพื่อเข้าสู่แบบประเมินดิจิทัล พร้อมเกณฑ์รูบริกส์ (Rubrics) ชัดเจน</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <!-- Tool 1: Supervisor -->
          <div class="academic-card interactive p-6 flex flex-col justify-between border border-slate-200">
            <div>
              <div class="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl mb-4 font-bold">
                <i class="fas fa-user-tie"></i>
              </div>
              <span class="academic-badge mb-2">ชุดที่ 1 • สำหรับศึกษานิเทศก์</span>
              <h3 class="text-lg font-bold text-slate-800 mb-2">เครื่องมือสำหรับศึกษานิเทศก์</h3>
              <p class="text-sm text-slate-600 mb-4 line-clamp-3">
                ประเมินบทบาท Coach & Facilitator, การหนุนเสริม Active Learning (6 โอกาส 7 สถานการณ์), สภาพแวดล้อม, วินัยเชิงบวก, PLC, AAR
              </p>
            </div>
            <button onclick="window.EF_APP.openForm('supervisor')" class="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm flex items-center justify-center gap-2 transition">
              <span>เริ่มทำแบบประเมิน</span>
              <i class="fas fa-arrow-right text-xs"></i>
            </button>
          </div>

          <!-- Tool 2: School -->
          <div class="academic-card interactive p-6 flex flex-col justify-between border border-slate-200">
            <div>
              <div class="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl mb-4 font-bold">
                <i class="fas fa-school"></i>
              </div>
              <span class="academic-badge mb-2">ชุดที่ 2 • สำหรับสถานศึกษา</span>
              <h3 class="text-lg font-bold text-slate-800 mb-2">เครื่องมือสำหรับโรงเรียน</h3>
              <p class="text-sm text-slate-600 mb-4 line-clamp-3">
                ประเมินการขับเคลื่อนนโยบาย EF สู่แผนปฏิบัติการ, Active Learning 6 โอกาส, สภาพแวดล้อมกายภาพและจิตวิทยา พร้อม Action Plan
              </p>
            </div>
            <button onclick="window.EF_APP.openForm('school')" class="w-full py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-sm flex items-center justify-center gap-2 transition">
              <span>เริ่มทำแบบประเมิน</span>
              <i class="fas fa-arrow-right text-xs"></i>
            </button>
          </div>

          <!-- Tool 3: Teacher -->
          <div class="academic-card interactive p-6 flex flex-col justify-between border border-slate-200">
            <div>
              <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl mb-4 font-bold">
                <i class="fas fa-chalkboard-teacher"></i>
              </div>
              <span class="academic-badge mb-2">ชุดที่ 3 • นิเทศครูผู้สอน</span>
              <h3 class="text-lg font-bold text-slate-800 mb-2">เครื่องมือนิเทศ ติดตามครูผู้สอน</h3>
              <p class="text-sm text-slate-600 mb-4 line-clamp-3">
                ประเมิน 4 องค์ประกอบ: ฐานราก 3 มิติ, บรรยากาศปลอดภัย/วินัยเชิงบวก, Active Learning 6 โอกาส และการมีส่วนร่วมของครอบครัว
              </p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button onclick="window.EF_APP.openForm('teacher_early')" class="py-2.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs text-center transition flex items-center justify-center gap-1">
                <span>ครูปฐมวัย (อ.1-3)</span>
              </button>
              <button onclick="window.EF_APP.openForm('teacher_primary')" class="py-2.5 px-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-medium text-xs text-center transition flex items-center justify-center gap-1">
                <span>ครูประถม (ป.1-3)</span>
              </button>
            </div>
          </div>

          <!-- Tool 4: Student (Early & Primary) -->
          <div class="academic-card interactive p-6 flex flex-col justify-between border border-slate-200">
            <div>
              <div class="w-12 h-12 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center text-xl mb-4 font-bold">
                <i class="fas fa-child"></i>
              </div>
              <span class="academic-badge mb-2">ชุดที่ 4 • ครูประเมินเด็ก</span>
              <h3 class="text-lg font-bold text-slate-800 mb-2">แบบประเมิน EF นักเรียน (9 ด้าน)</h3>
              <p class="text-sm text-slate-600 mb-4">
                ประเมินพฤติกรรมเด็ก 9 ด้าน (Basic, Self-Regulation, Practice Skills) แยกตามระดับชั้น
              </p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button onclick="window.EF_APP.openForm('student_early')" class="py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium text-xs text-center transition">
                ระดับปฐมวัย (3-6 ปี)
              </button>
              <button onclick="window.EF_APP.openForm('student_primary')" class="py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs text-center transition">
                ระดับประถม (7-9 ปี)
              </button>
            </div>
          </div>

          <!-- Tool 5: Parent (Early & Primary) -->
          <div class="academic-card interactive p-6 flex flex-col justify-between border border-slate-200">
            <div>
              <div class="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-xl mb-4 font-bold">
                <i class="fas fa-hands-holding-child"></i>
              </div>
              <span class="academic-badge mb-2">ชุดที่ 5 • ผู้ปกครองประเมิน</span>
              <h3 class="text-lg font-bold text-slate-800 mb-2">แบบประเมินตนเองของผู้ปกครอง</h3>
              <p class="text-sm text-slate-600 mb-4">
                ประเมินการส่งเสริมของ ผปค. 9 ด้าน + สังเกตพฤติกรรมลูกที่บ้าน และเสียงสะท้อนความต้องการ
              </p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button onclick="window.EF_APP.openForm('parent_early')" class="py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs text-center transition">
                เด็กปฐมวัย
              </button>
              <button onclick="window.EF_APP.openForm('parent_primary')" class="py-2 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium text-xs text-center transition">
                เด็กประถม
              </button>
            </div>
          </div>

          <!-- Hub Feature Card -->
          <div class="academic-card interactive p-6 flex flex-col justify-between bg-gradient-to-br from-slate-900 to-blue-950 text-white border-none shadow-xl">
            <div>
              <div class="w-12 h-12 rounded-xl bg-amber-400 text-slate-900 flex items-center justify-center text-xl mb-4 font-bold">
                <i class="fas fa-qrcode"></i>
              </div>
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-400/20 text-amber-300 border border-amber-400/30 mb-2">
                การส่งลิงก์แบบง่าย
              </span>
              <h3 class="text-lg font-bold text-white mb-2">ระบบส่งต่อ Link & QR Code</h3>
              <p class="text-sm text-slate-300 mb-4">
                โรงเรียนสามารถสร้างการ์ด QR Code และลิงก์สำเร็จรูปเฉพาะโรงเรียน ส่งให้ครูและผู้ปกครองตอบได้ทันทีใน 1 วินาที
              </p>
            </div>
            <button onclick="window.EF_APP.navigate('school-hub')" class="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition">
              <span>ไปยังโรงเรียนในสังกัด</span>
              <i class="fas fa-arrow-right text-xs"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 2. SCHOOL HUB VIEW (ระบบกระจายเครื่องมือเฉพาะโรงเรียน)
  // =========================================================================
  function renderSchoolHubView() {
    const container = document.getElementById('view-school-hub');
    if (!container) return;

    const schools = window.NAN1_SCHOOLS || [];
    const groups = [...new Set(schools.map(s => s.group))].sort();

    // Default select first school if none
    if (!state.selectedSchool && schools.length > 0) {
      state.selectedSchool = schools[0];
    }

    container.innerHTML = `
      <div class="mb-8">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 class="text-2xl md:text-3xl font-bold text-slate-800">โรงเรียนในสังกัด 145 แห่ง (School Hub)</h2>
            <p class="text-sm text-slate-500">เลือกรหัส/ชื่อโรงเรียน เพื่อสร้างลิงก์ & QR Code เฉพาะโรงเรียน แจกจ่ายให้ครูและผู้ปกครอง</p>
          </div>
          
          <!-- Search & Filter & Export -->
          <div class="flex items-center gap-2.5 flex-wrap">
            <select id="hub-group-filter" class="bg-white border border-slate-300 text-slate-700 text-sm rounded-xl px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm">
              <option value="all">ทุกกลุ่มโรงเรียน (${groups.length} กลุ่ม)</option>
              ${groups.map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>
            <button onclick="window.EF_APP.openExportProgressModal()" class="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition active:scale-95" title="Export ติดตามความคืบหน้ารายโรงเรียนเป็น CSV หรือ Excel">
              <i class="fas fa-file-csv"></i>
              <span>Export CSV/Excel</span>
            </button>
          </div>
        </div>
      </div>

      <!-- School Selector Grid / Dropdown -->
      <div class="academic-card p-6 mb-8 bg-gradient-to-r from-blue-50/50 to-white border-blue-200">
        <label class="block text-sm font-bold text-slate-700 mb-2">
          <i class="fas fa-search text-blue-600 mr-1.5"></i> ค้นหาหรือเลือกโรงเรียน:
        </label>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="md:col-span-2">
            <input type="text" id="hub-school-search" placeholder="พิมพ์ชื่อโรงเรียน หรือ รหัสโรงเรียน เช่น บ้านดอน, นาราบ, 55010..." 
              class="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-800 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm">
          </div>
          <div>
            <select id="hub-school-select" class="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-800 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm">
              ${schools.map(s => `<option value="${s.id}" ${state.selectedSchool && state.selectedSchool.id === s.id ? 'selected' : ''}>${s.name} (${s.group})</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Selected School Profile & Quick Dispatch Dashboard -->
      <div id="school-hub-detail" class="space-y-8">
        <!-- Rendered dynamically -->
      </div>
    `;

    // Hook events
    const searchInput = document.getElementById('hub-school-search');
    const selectEl = document.getElementById('hub-school-select');
    const groupFilter = document.getElementById('hub-group-filter');

    function updateSchoolList() {
      const q = (searchInput.value || '').trim().toLowerCase();
      const grp = groupFilter.value;

      const filtered = schools.filter(s => {
        const matchSearch = s.name.toLowerCase().includes(q) || s.id.includes(q);
        const matchGroup = grp === 'all' || s.group === grp;
        return matchSearch && matchGroup;
      });

      selectEl.innerHTML = filtered.map(s => 
        `<option value="${s.id}" ${state.selectedSchool && state.selectedSchool.id === s.id ? 'selected' : ''}>${s.name} (${s.group})</option>`
      ).join('');

      if (filtered.length > 0) {
        if (!filtered.some(s => state.selectedSchool && s.id === state.selectedSchool.id)) {
          state.selectedSchool = filtered[0];
        }
      }
      renderSchoolHubDetail();
    }

    searchInput.addEventListener('input', updateSchoolList);
    groupFilter.addEventListener('change', updateSchoolList);
    selectEl.addEventListener('change', (e) => {
      const found = schools.find(s => s.id === e.target.value);
      if (found) {
        state.selectedSchool = found;
        renderSchoolHubDetail();
      }
    });

    renderSchoolHubDetail();
  }

  function renderSchoolHubDetail() {
    const detailContainer = document.getElementById('school-hub-detail');
    if (!detailContainer || !state.selectedSchool) return;

    const s = state.selectedSchool;
    const baseUrl = window.location.origin + window.location.pathname;

    // Filter submissions for this school
    const schoolSubs = state.submissions.filter(sub => sub.schoolId === s.id);
    const subCount = schoolSubs.length;

    detailContainer.innerHTML = `
      <!-- School Info Card -->
      <div class="academic-card p-6 md:p-8 bg-white border border-slate-200">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-100">
          <div class="flex items-start gap-4">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-800 text-white flex items-center justify-center text-2xl font-bold shadow-lg shadow-blue-500/20">
              <i class="fas fa-school"></i>
            </div>
            <div>
              <div class="flex flex-wrap items-center gap-2 mb-1">
                <span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800">${s.group}</span>
                <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">${s.district}</span>
                <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">${s.schoolSize}</span>
              </div>
              <h3 class="text-2xl font-bold text-slate-800">${s.name}</h3>
              <p class="text-xs text-slate-500 mt-1 font-mono">รหัสสถานศึกษา: ${s.id} • สพป.น่าน เขต 1</p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button onclick="window.EF_APP.viewSchoolReport('${s.id}')" class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm flex items-center gap-2 transition">
              <i class="fas fa-file-alt text-blue-600"></i>
              <span>ดูรายงานโรงเรียนนี้</span>
            </button>
          </div>
        </div>

        <!-- Student Stats Grid -->
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6">
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <div class="text-xs text-slate-500">ปฐมวัย (อ.1-3)</div>
            <div class="text-xl font-bold text-slate-800 mt-1">${s.earlyStudents} <span class="text-xs font-normal">คน</span></div>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <div class="text-xs text-slate-500">ประถม (ป.1-6)</div>
            <div class="text-xl font-bold text-slate-800 mt-1">${s.primaryStudents} <span class="text-xs font-normal">คน</span></div>
          </div>
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <div class="text-xs text-slate-500">มัธยม (ม.1-3)</div>
            <div class="text-xl font-bold text-slate-800 mt-1">${s.secondaryStudents} <span class="text-xs font-normal">คน</span></div>
          </div>
          <div class="p-3.5 rounded-xl bg-blue-50/60 border border-blue-100 text-center">
            <div class="text-xs text-blue-700 font-semibold">นักเรียนรวมทั้งหมด</div>
            <div class="text-xl font-bold text-blue-800 mt-1">${s.totalStudents} <span class="text-xs font-normal">คน</span></div>
          </div>
          <div class="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-100 text-center col-span-2 sm:col-span-1">
            <div class="text-xs text-emerald-700 font-semibold">ส่งแบบประเมินแล้ว</div>
            <div class="text-xl font-bold text-emerald-800 mt-1">${subCount} <span class="text-xs font-normal">ชุด</span></div>
          </div>
        </div>
      </div>

      <!-- Quick Dispatch Links & QR Code Generator -->
      <div>
        <div class="flex items-center justify-between mb-4">
          <div>
            <h4 class="text-xl font-bold text-slate-800">เครื่องมือส่งต่อให้กลุ่มเป้าหมาย (Quick Dispatch)</h4>
            <p class="text-xs text-slate-500">ลิงก์และ QR Code ได้ล็อกรหัสโรงเรียน <strong>${s.name}</strong> ให้อัตโนมัติ ผู้ตอบไม่ต้องพิมพ์ชื่อโรงเรียนเอง</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          ${renderDispatchCard('ครูปฐมวัย (อ.1-3)', 'teacher_early', s, 'fa-chalkboard-teacher', 'emerald', 'สำหรับครูปฐมวัยสังเกตพฤติกรรมการสอนและรับการนิเทศ')}
          ${renderDispatchCard('ครูประถม (สุขศึกษา/พลฯ ป.1-3)', 'teacher_primary', s, 'fa-chalkboard-user', 'teal', 'สำหรับครูสุขศึกษาและพลศึกษา สังเกตพฤติกรรมการสอนและรับการนิเทศ')}
          ${renderDispatchCard('นักเรียนปฐมวัย (3-6 ปี)', 'student_early', s, 'fa-child', 'sky', 'ครูปฐมวัยประเมินพฤติกรรม EF 9 ด้าน')}
          ${renderDispatchCard('นักเรียนประถม (7-9 ปี)', 'student_primary', s, 'fa-user-graduate', 'indigo', 'ครูประถมประเมินพฤติกรรม EF 9 ด้าน')}
          ${renderDispatchCard('ผู้ปกครองปฐมวัย', 'parent_early', s, 'fa-hands-holding-child', 'rose', 'ผู้ปกครองประเมินตนเอง + เด็กที่บ้าน')}
          ${renderDispatchCard('ผู้ปกครองประถม', 'parent_primary', s, 'fa-heart', 'purple', 'ผู้ปกครองประเมินตนเอง + เด็กที่บ้าน')}
          ${renderDispatchCard('ผู้บริหาร / สถานศึกษา', 'school', s, 'fa-landmark', 'amber', 'ผู้บริหารประเมินการขับเคลื่อน EF ของโรงเรียน')}
        </div>
      </div>
    `;

    // Render QR codes for each card
    setTimeout(() => {
      ['teacher_early', 'teacher_primary', 'teacher', 'student_early', 'student_primary', 'parent_early', 'parent_primary', 'school'].forEach(type => {
        const qrContainer = document.getElementById(`qr-canvas-${type}`);
        if (qrContainer && window.QRCode) {
          qrContainer.innerHTML = '';
          const targetUrl = `${baseUrl}?form=${type}&schoolId=${s.id}`;
          new QRCode(qrContainer, {
            text: targetUrl,
            width: 130,
            height: 130,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      });
    }, 100);
  }

  function renderDispatchCard(title, formType, school, icon, colorTheme, desc) {
    const baseUrl = window.location.origin + window.location.pathname;
    const targetUrl = `${baseUrl}?form=${formType}&schoolId=${school.id}`;
    const lineMessage = encodeURIComponent(
      `📢 ขอเชิญร่วมตอบ [${title}]\nโครงการส่งเสริมทักษะสมอง EF 69\n🏫 โรงเรียน: ${school.name} (สพป.น่าน เขต 1)\n🔗 คลิกลิงก์ทำแบบประเมินได้ทันที:\n${targetUrl}`
    );

    return `
      <div class="academic-card p-5 flex flex-col justify-between border-t-4 border-t-${colorTheme}-500 bg-white">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-${colorTheme}-50 text-${colorTheme}-700 border border-${colorTheme}-200">
              <i class="fas ${icon} mr-1"></i> ${title}
            </span>
          </div>

          <p class="text-xs text-slate-500 mb-4 min-h-[32px]">${desc}</p>

          <!-- QR Code Preview Box -->
          <div class="flex flex-col items-center justify-center p-3.5 bg-slate-50 rounded-xl border border-slate-200 mb-4">
            <div id="qr-canvas-${formType}" class="p-1.5 bg-white rounded-lg shadow-sm"></div>
            <span class="text-[11px] text-slate-400 mt-2 font-mono">สแกนเพื่อเริ่มทำแบบประเมิน</span>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="space-y-2">
          <div class="grid grid-cols-2 gap-2">
            <button onclick="window.EF_APP.copyLink('${targetUrl}')" class="py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition">
              <i class="fas fa-copy text-slate-500"></i>
              <span>คัดลอกลิงก์</span>
            </button>
            <a href="https://line.me/R/msg/text/?${lineMessage}" target="_blank" class="py-2 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition">
              <i class="fab fa-line text-emerald-500 text-sm"></i>
              <span>แชร์เข้า LINE</span>
            </a>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button onclick="window.EF_APP.openForm('${formType}', '${school.id}')" class="py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition">
              <i class="fas fa-edit"></i>
              <span>เปิดฟอร์ม</span>
            </button>
            <button onclick="window.EF_APP.printQrCard('${title}', '${formType}', '${school.name}', '${school.group}', '${targetUrl}')" class="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition">
              <i class="fas fa-print"></i>
              <span>พิมพ์การ์ด QR</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 3. EVALUATION PORTAL (ศูนย์เลือกทำแบบประเมิน)
  // =========================================================================
  function renderEvalPortalView() {
    const container = document.getElementById('view-eval-portal');
    if (!container) return;

    container.innerHTML = `
      <div class="max-w-4xl mx-auto mb-10 text-center">
        <h2 class="text-3xl font-bold text-slate-800 mb-3">ศูนย์รวมแบบประเมินดิจิทัล (Evaluation Portal)</h2>
        <p class="text-slate-600">กรุณาเลือกประเภทแบบประเมินที่ต้องการบันทึกข้อมูล ระบบจะคำนวณและแปลผลคะแนนให้อัตโนมัติ</p>
      </div>

      <div class="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- 1. Supervisor -->
        <div class="academic-card p-6 border-l-4 border-l-blue-600">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl shrink-0 font-bold">
              <i class="fas fa-user-tie"></i>
            </div>
            <div class="flex-1">
              <span class="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">ศึกษานิเทศก์ / เขตพื้นที่</span>
              <h3 class="text-lg font-bold text-slate-800 mt-1">1. เครื่องมือนิเทศ ติดตาม สำหรับศึกษานิเทศก์</h3>
              <p class="text-xs text-slate-500 mt-1 mb-4">10 ตัวบ่งชี้การขับเคลื่อนนโยบาย EF, การนิเทศ Active Learning, วินัยเชิงบวก และ PLC</p>
              <button onclick="window.EF_APP.openForm('supervisor')" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition">
                เปิดแบบประเมิน
              </button>
            </div>
          </div>
        </div>

        <!-- 2. School -->
        <div class="academic-card p-6 border-l-4 border-l-amber-600">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl shrink-0 font-bold">
              <i class="fas fa-school"></i>
            </div>
            <div class="flex-1">
              <span class="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">สถานศึกษา / ผู้บริหาร</span>
              <h3 class="text-lg font-bold text-slate-800 mt-1">2. เครื่องมือสำหรับโรงเรียน</h3>
              <p class="text-xs text-slate-500 mt-1 mb-4">20 ข้อ (การบริหารนโยบาย 10 ข้อ + Active Learning/สภาพแวดล้อม 10 ข้อ + Action Plan)</p>
              <button onclick="window.EF_APP.openForm('school')" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition">
                เปิดแบบประเมิน
              </button>
            </div>
          </div>
        </div>

        <!-- 3. Teacher -->
        <div class="academic-card p-6 border-l-4 border-l-emerald-600">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl shrink-0 font-bold">
              <i class="fas fa-chalkboard-teacher"></i>
            </div>
            <div class="flex-1">
              <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">ครูผู้สอน / ผู้นิเทศภายใน</span>
              <h3 class="text-lg font-bold text-slate-800 mt-1">3. เครื่องมือนิเทศ ติดตามครูผู้สอน</h3>
              <p class="text-xs text-slate-500 mt-1 mb-4">4 องค์ประกอบ 18 ข้อ (ฐานราก 3 มิติ, บรรยากาศปลอดภัย, 6 โอกาส, และครอบครัว)</p>
              <div class="flex flex-wrap gap-2">
                <button onclick="window.EF_APP.openForm('teacher_early')" class="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition">
                  สำหรับครูปฐมวัย (อ.1-3)
                </button>
                <button onclick="window.EF_APP.openForm('teacher_primary')" class="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold transition">
                  สำหรับครูประถม (สุขศึกษา/พลฯ)
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Student (Early & Primary) -->
        <div class="academic-card p-6 border-l-4 border-l-sky-600">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center text-xl shrink-0 font-bold">
              <i class="fas fa-child"></i>
            </div>
            <div class="flex-1">
              <span class="text-xs font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded">ครูประเมินนักเรียน</span>
              <h3 class="text-lg font-bold text-slate-800 mt-1">4. แบบประเมินพฤติกรรมทักษะสมอง EF นักเรียน</h3>
              <p class="text-xs text-slate-500 mt-1 mb-4">9 ด้าน EF (18 ข้อ) พร้อมเกณฑ์รูบริกส์ตามระดับชั้น</p>
              <div class="flex gap-2">
                <button onclick="window.EF_APP.openForm('student_early')" class="px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold transition">
                  ปฐมวัย (3-6 ปี)
                </button>
                <button onclick="window.EF_APP.openForm('student_primary')" class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition">
                  ประถม (7-9 ปี)
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 5. Parent (Early & Primary) -->
        <div class="academic-card p-6 border-l-4 border-l-rose-600 md:col-span-2">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-xl shrink-0 font-bold">
              <i class="fas fa-hands-holding-child"></i>
            </div>
            <div class="flex-1">
              <span class="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">ผู้ปกครองประเมิน</span>
              <h3 class="text-lg font-bold text-slate-800 mt-1">5. แบบประเมินตนเองของผู้ปกครอง และการสังเกตพฤติกรรมที่บ้าน</h3>
              <p class="text-xs text-slate-500 mt-1 mb-4">ส่วนที่ 1: การส่งเสริมของ ผปค. 9 ด้าน (18 ข้อ) + ส่วนที่ 2: พฤติกรรมเด็กที่บ้าน (18 ข้อ) + เสียงสะท้อนจากใจ</p>
              <div class="flex gap-3">
                <button onclick="window.EF_APP.openForm('parent_early')" class="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition">
                  สำหรับผู้ปกครองเด็กปฐมวัย
                </button>
                <button onclick="window.EF_APP.openForm('parent_primary')" class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold transition">
                  สำหรับผู้ปกครองเด็กประถม
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 4. DYNAMIC EVALUATION FORM VIEW (หน้าทำแบบประเมิน)
  // =========================================================================
  function renderEvalFormView() {
    const container = document.getElementById('view-eval-form');
    if (!container) return;

    const formType = state.activeFormType || 'school';
    state.formAnswers = {};
    state.formMeta = {
      date: getThaiDateISO()
    };
    state.attachment = null;

    const schools = window.NAN1_SCHOOLS || [];
    const questions = window.EF_QUESTIONS;

    let formTitle = '';
    let formSubtitle = '';
    let formHtml = '';

    // Choose form template
    if (formType === 'supervisor') {
      const q = questions.supervisor;
      formTitle = q.title;
      formSubtitle = q.subtitle;
      formHtml = renderSupervisorForm(q);
    } else if (formType === 'school') {
      const q = questions.school;
      formTitle = q.title;
      formSubtitle = q.subtitle;
      formHtml = renderSchoolForm(q);
    } else if (formType === 'teacher_early') {
      const q = questions.teacher;
      formTitle = 'เครื่องมือนิเทศ ติดตามการหนุนเสริมครูผู้สอนระดับการศึกษาปฐมวัย (EF)';
      formSubtitle = 'สำหรับครูผู้สอนระดับปฐมวัย / ผู้นิเทศภายใน / ศึกษานิเทศก์';
      formHtml = renderTeacherForm(q);
    } else if (formType === 'teacher_primary') {
      const q = questions.teacher;
      formTitle = 'เครื่องมือนิเทศ ติดตามการหนุนเสริมครูผู้สอนกลุ่มสาระสุขศึกษาและพลศึกษา ป.1-3 (EF)';
      formSubtitle = 'สำหรับครูผู้สอนกลุ่มสาระสุขศึกษาและพลศึกษา / ผู้นิเทศภายใน / ศึกษานิเทศก์';
      formHtml = renderTeacherForm(q);
    } else if (formType === 'teacher') {
      const q = questions.teacher;
      formTitle = q.title;
      formSubtitle = q.subtitle;
      formHtml = renderTeacherForm(q);
    } else if (formType === 'student_early') {
      const q = questions.student.early;
      formTitle = q.title;
      formSubtitle = q.subtitle;
      formHtml = renderStudentForm(q, 'early');
    } else if (formType === 'student_primary') {
      const q = questions.student.primary;
      formTitle = q.title;
      formSubtitle = q.subtitle;
      formHtml = renderStudentForm(q, 'primary');
    } else if (formType === 'parent_early') {
      const q = questions.parent.early;
      formTitle = q.title;
      formSubtitle = q.subtitle;
      formHtml = renderParentForm(q, 'early');
    } else if (formType === 'parent_primary') {
      const q = questions.parent.primary;
      formTitle = q.title;
      formSubtitle = q.subtitle;
      formHtml = renderParentForm(q, 'primary');
    }

    container.innerHTML = `
      <div class="max-w-4xl mx-auto mb-8">
        <button onclick="window.EF_APP.navigate('eval-portal')" class="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1.5 mb-4">
          <i class="fas fa-arrow-left"></i> กลับหน้ารวมแบบประเมิน
        </button>

        <div class="academic-card p-6 md:p-8 bg-gradient-to-r from-blue-900 to-indigo-900 text-white rounded-2xl mb-8 shadow-xl">
          <span class="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-amber-400 text-slate-950 mb-3">
            แบบประเมินดิจิทัล • สพป.น่าน เขต 1
          </span>
          <h2 class="text-2xl md:text-3xl font-bold leading-snug">${formTitle}</h2>
          <p class="text-sm text-slate-300 mt-2 font-light">${formSubtitle}</p>
        </div>

        <!-- Form Component -->
        <form id="evaluation-form" onsubmit="window.EF_APP.handleFormSubmit(event)">
          <!-- School & General Info Section -->
          ${renderGeneralInfoSection(schools)}

          <!-- Questions Content -->
          ${formHtml}

          <!-- Optional Attachment Section (Supervisor, School, Teacher) -->
          ${renderAttachmentSection(formType)}

          <!-- Live Score & Result Preview Card -->
          <div class="academic-card p-6 mb-8 bg-gradient-to-br from-slate-50 to-blue-50/50 border border-blue-200">
            <h4 class="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
              <i class="fas fa-chart-line text-blue-600"></i>
              <span>สรุปผลการประเมินเบื้องต้น (Live Score)</span>
            </h4>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div class="p-4 bg-white rounded-xl border border-slate-200 text-center shadow-sm">
                <span class="text-xs text-slate-500 font-medium">คะแนนรวมที่ได้</span>
                <div id="live-total-score" class="text-3xl font-bold text-blue-600 mt-1">0</div>
              </div>
              <div class="p-4 bg-white rounded-xl border border-slate-200 text-center shadow-sm">
                <span class="text-xs text-slate-500 font-medium">คะแนนเฉลี่ย</span>
                <div id="live-avg-score" class="text-3xl font-bold text-indigo-600 mt-1">0.00</div>
              </div>
              <div class="p-4 bg-white rounded-xl border border-slate-200 text-center shadow-sm">
                <span class="text-xs text-slate-500 font-medium">ระดับคุณภาพ / การเติบโต</span>
                <div id="live-quality-level" class="text-base font-bold text-slate-700 mt-2">-</div>
              </div>
            </div>
          </div>

          <!-- Submit Button Group -->
          <div class="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-white rounded-2xl border border-slate-200 shadow-lg">
            <div class="text-xs text-slate-500">
              <i class="fas fa-shield-alt text-emerald-600 mr-1"></i>
              ข้อมูลจะถูกบันทึกสู่ระบบฐานข้อมูลคลาวด์ สพป.น่าน เขต 1 อย่างปลอดภัย
            </div>

            <div class="flex items-center gap-3 w-full sm:w-auto">
              <button type="button" onclick="window.EF_APP.navigate('eval-portal')" class="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition">
                ยกเลิก
              </button>
              <button type="submit" id="btn-submit-eval" class="w-full sm:w-auto px-8 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white text-sm font-bold shadow-lg shadow-blue-500/30 transition transform hover:-translate-y-0.5 flex items-center justify-center gap-2">
                <i class="fas fa-paper-plane"></i>
                <span>บันทึกและส่งแบบประเมิน</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    `;

    // Hook 2-step group and school change
    const groupSel = document.getElementById('form-group-select');
    const schoolSel = document.getElementById('form-school-select');

    if (groupSel && schoolSel) {
      groupSel.addEventListener('change', (e) => {
        const grp = e.target.value;
        if (!grp) {
          schoolSel.innerHTML = '<option value="">-- กรุณาเลือกกลุ่มโรงเรียนก่อน --</option>';
          schoolSel.disabled = true;
          updateGeneralInfoAutoFill(null);
          return;
        }

        const groupSchools = schools.filter(s => s.group === grp);
        schoolSel.innerHTML = '<option value="">-- กรุณาเลือกโรงเรียน --</option>' +
          groupSchools.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        schoolSel.disabled = false;
        updateGeneralInfoAutoFill(null);
      });

      schoolSel.addEventListener('change', (e) => {
        const found = schools.find(s => s.id === e.target.value);
        state.selectedSchool = found || null;
        updateGeneralInfoAutoFill(found);
      });

      if (state.selectedSchool) {
        groupSel.value = state.selectedSchool.group;
        const groupSchools = schools.filter(s => s.group === state.selectedSchool.group);
        schoolSel.innerHTML = '<option value="">-- กรุณาเลือกโรงเรียน --</option>' +
          groupSchools.map(s => `<option value="${s.id}" ${s.id === state.selectedSchool.id ? 'selected' : ''}>${s.name}</option>`).join('');
        schoolSel.disabled = false;
        updateGeneralInfoAutoFill(state.selectedSchool);
      }
    }
  }

  function renderGeneralInfoSection(schools) {
    const defaultDate = getThaiDateISO();
    const groups = [...new Set(schools.map(s => s.group))].sort();
    const sel = state.selectedSchool || null;
    const selGroup = sel ? sel.group : '';
    const filteredSchools = selGroup ? schools.filter(s => s.group === selGroup) : [];

    return `
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-3 border-b border-slate-100 mb-6 flex items-center gap-2">
          <i class="fas fa-id-card text-blue-600"></i>
          <span>ตอนที่ 1 : ข้อมูลทั่วไป</span>
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
          <!-- Step 1: Group Select -->
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1.5">
              1. เลือกกลุ่มโรงเรียน <span class="text-rose-500">*</span>
            </label>
            <select id="form-group-select" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="">-- กรุณาเลือกกลุ่มโรงเรียน --</option>
              ${groups.map(g => `<option value="${g}" ${selGroup === g ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
          </div>

          <!-- Step 2: School Select -->
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1.5">
              2. เลือกโรงเรียน <span class="text-rose-500">*</span>
            </label>
            <select id="form-school-select" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" ${!selGroup ? 'disabled' : ''}>
              <option value="">${selGroup ? '-- กรุณาเลือกโรงเรียน --' : '-- กรุณาเลือกกลุ่มโรงเรียนก่อน --'}</option>
              ${filteredSchools.map(s => `<option value="${s.id}" ${sel && sel.id === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </div>

          <!-- Auto-filled Info -->
          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-slate-700 mb-1.5">ข้อมูลสถานศึกษา (ดึงอัตโนมัติ)</label>
            <input type="text" id="form-school-group-display" readonly value="${sel ? sel.name + ' • ' + sel.group + ' • ' + sel.district + ' (นักเรียน ' + sel.totalStudents + ' คน, ' + sel.schoolSize + ')' : 'กรุณาเลือกกลุ่มโรงเรียนและโรงเรียน'}" class="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-600 cursor-not-allowed">
          </div>

          <!-- Dynamic fields depending on form type -->
          ${renderSpecificMetaInputs()}

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1.5">วันที่ประเมิน <span class="text-rose-500">*</span></label>
            <input type="date" id="form-eval-date" required value="${defaultDate}" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
          </div>
        </div>
      </div>
    `;
  }

  function renderSpecificMetaInputs() {
    const t = state.activeFormType;
    if (t === 'supervisor') {
      return `
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-สกุล ผู้รับการนิเทศ (ครู/ผู้บริหาร) <span class="text-rose-500">*</span></label>
          <input type="text" id="form-recipient-name" required placeholder="ระบุชื่อ-นามสกุล ครูผู้รับการนิเทศ" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ช่วงชั้นที่จัดการเรียนการสอน (ผู้รับการนิเทศ) <span class="text-rose-500">*</span></label>
          <select id="form-teacher-stage" required onchange="window.EF_APP.onTeacherStageChange(this.value)" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="early">ระดับปฐมวัย (อนุบาล 1 - 3)</option>
            <option value="primary">ระดับประถมศึกษา (ป.1 - ป.3)</option>
          </select>
        </div>
        <div id="form-teacher-grade-container" class="md:col-span-2">
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้นที่ตนเองรับผิดชอบ/จัดการเรียนการสอน <span class="text-rose-500">*</span></label>
          <select id="form-grade-level" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="a1">1. ชั้นอนุบาล 1</option>
            <option value="a2">2. ชั้นอนุบาล 2</option>
            <option value="a3">3. ชั้นอนุบาล 3</option>
            <option value="multi_early">4. สอนรวมชั้น/หลายชั้น</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-สกุล ผู้นิเทศ / ศึกษานิเทศก์ผู้ประเมิน <span class="text-rose-500">*</span></label>
          <input type="text" id="form-evaluator-name" required value="นายพุฒิพงษ์ วงศ์นันท์" placeholder="ระบุชื่อศึกษานิเทศก์" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
      `;
    } else if (t === 'school') {
      return `
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อผู้บันทึก / ผู้บริหารสถานศึกษา <span class="text-rose-500">*</span></label>
          <input type="text" id="form-evaluator-name" required placeholder="เช่น ผู้อำนวยการโรงเรียน หรือ ครูผู้รับผิดชอบ" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
      `;
    } else if (t === 'teacher' || t === 'teacher_early' || t === 'teacher_primary') {
      const isPrimary = t === 'teacher_primary';
      return `
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-นามสกุล ครูผู้รับการนิเทศ / ครูผู้สอน <span class="text-rose-500">*</span></label>
          <input type="text" id="form-evaluator-name" required placeholder="ระบุชื่อ-นามสกุลครูผู้สอน" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ช่วงชั้นที่จัดการเรียนการสอน <span class="text-rose-500">*</span></label>
          <select id="form-teacher-stage" required onchange="window.EF_APP.onTeacherStageChange(this.value)" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="early" ${!isPrimary ? 'selected' : ''}>ระดับปฐมวัย (อนุบาล 1 - 3)</option>
            <option value="primary" ${isPrimary ? 'selected' : ''}>ระดับประถมศึกษา (ป.1 - ป.3)</option>
          </select>
        </div>
        <div id="form-teacher-grade-container" class="md:col-span-2">
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้นที่ตนเองรับผิดชอบ/จัดการเรียนการสอน <span class="text-rose-500">*</span></label>
          <select id="form-grade-level" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            ${!isPrimary ? `
              <option value="a1">1. ชั้นอนุบาล 1</option>
              <option value="a2">2. ชั้นอนุบาล 2</option>
              <option value="a3">3. ชั้นอนุบาล 3</option>
              <option value="multi_early">4. สอนรวมชั้น/หลายชั้น</option>
            ` : `
              <option value="p1">1. ชั้น ป.1</option>
              <option value="p2">2. ชั้น ป.2</option>
              <option value="p3">3. ชั้น ป.3</option>
              <option value="multi_primary">4. สอนรวมชั้น/หลายชั้น</option>
            `}
          </select>
        </div>
      `;
    } else if (t === 'student_early') {
      return `
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-สกุล นักเรียนปฐมวัย <span class="text-rose-500">*</span></label>
          <input type="text" id="form-student-name" required placeholder="ระบุชื่อนักเรียนที่ประเมิน" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้นที่ตนเองรับผิดชอบ/จัดการเรียนการสอน <span class="text-rose-500">*</span></label>
          <select id="form-grade-level" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="a1">1. ชั้นอนุบาล 1</option>
            <option value="a2">2. ชั้นอนุบาล 2</option>
            <option value="a3">3. ชั้นอนุบาล 3</option>
            <option value="multi_early">4. สอนรวมชั้น/หลายชั้น</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อครูผู้ประเมิน / ครูประจำชั้น <span class="text-rose-500">*</span></label>
          <input type="text" id="form-evaluator-name" required placeholder="ระบุชื่อครูผู้สังเกตพฤติกรรม" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
      `;
    } else if (t === 'student_primary') {
      return `
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-สกุล นักเรียนประถม <span class="text-rose-500">*</span></label>
          <input type="text" id="form-student-name" required placeholder="ระบุชื่อนักเรียนที่ประเมิน" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้นที่ตนเองรับผิดชอบ/จัดการเรียนการสอน <span class="text-rose-500">*</span></label>
          <select id="form-grade-level" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="p1">1. ชั้น ป.1</option>
            <option value="p2">2. ชั้น ป.2</option>
            <option value="p3">3. ชั้น ป.3</option>
            <option value="multi_primary">4. สอนรวมชั้น/หลายชั้น</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อครูผู้ประเมิน / ครูประจำชั้น <span class="text-rose-500">*</span></label>
          <input type="text" id="form-evaluator-name" required placeholder="ระบุชื่อครูผู้สังเกตพฤติกรรม" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
      `;
    } else if (t === 'parent_early') {
      return `
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-สกุล ผู้ปกครอง <span class="text-rose-500">*</span></label>
          <input type="text" id="form-parent-name" required placeholder="ระบุชื่อผู้ปกครอง" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ความสัมพันธ์กับนักเรียน</label>
          <select id="form-parent-relation" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="บิดา">บิดา</option>
            <option value="มารดา">มารดา</option>
            <option value="ปู่/ย่า/ตา/ยาย">ปู่/ย่า/ตา/ยาย</option>
            <option value="ผู้ปกครอง">ผู้ปกครองอื่นๆ</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-สกุล บุตรหลาน (นักเรียน) <span class="text-rose-500">*</span></label>
          <input type="text" id="form-student-name" required placeholder="ระบุชื่อบุตรหลาน" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้นของบุตรหลาน <span class="text-rose-500">*</span></label>
          <select id="form-grade-level" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="a1">1. ชั้นอนุบาล 1</option>
            <option value="a2">2. ชั้นอนุบาล 2</option>
            <option value="a3">3. ชั้นอนุบาล 3</option>
            <option value="multi_early">4. รวมชั้น/หลายชั้น</option>
          </select>
        </div>
      `;
    } else if (t === 'parent_primary') {
      return `
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-สกุล ผู้ปกครอง <span class="text-rose-500">*</span></label>
          <input type="text" id="form-parent-name" required placeholder="ระบุชื่อผู้ปกครอง" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ความสัมพันธ์กับนักเรียน</label>
          <select id="form-parent-relation" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="บิดา">บิดา</option>
            <option value="มารดา">มารดา</option>
            <option value="ปู่/ย่า/ตา/ยาย">ปู่/ย่า/ตา/ยาย</option>
            <option value="ผู้ปกครอง">ผู้ปกครองอื่นๆ</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ชื่อ-สกุล บุตรหลาน (นักเรียน) <span class="text-rose-500">*</span></label>
          <input type="text" id="form-student-name" required placeholder="ระบุชื่อบุตรหลาน" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้นของบุตรหลาน <span class="text-rose-500">*</span></label>
          <select id="form-grade-level" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
            <option value="p1">1. ชั้น ป.1</option>
            <option value="p2">2. ชั้น ป.2</option>
            <option value="p3">3. ชั้น ป.3</option>
            <option value="multi_primary">4. รวมชั้น/หลายชั้น</option>
          </select>
        </div>
      `;
    }
    return '';
  }

  function updateGeneralInfoAutoFill(sch) {
    const disp = document.getElementById('form-school-group-display');
    if (disp && sch) {
      disp.value = `${sch.group} • ${sch.district} (นักเรียน ${sch.totalStudents} คน, ${sch.schoolSize})`;
    }
  }

  // --- FORM RENDERERS ---
  function renderSupervisorForm(q) {
    return `
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-3 border-b border-slate-100 mb-6 flex items-center gap-2">
          <i class="fas fa-tasks text-blue-600"></i>
          <span>ตอนที่ 2 : รายการพฤติกรรมบ่งชี้ (10 ตัวบ่งชี้)</span>
        </h3>
        <p class="text-xs text-slate-500 mb-6">เกณฑ์ระดับคะแนน: 3 = ดีเยี่ยม (ปฏิบัติสม่ำเสมอ/เป็นโค้ช), 2 = ดี (ปฏิบัติตามแผน), 1 = ควรปรับปรุง (ปฏิบัติน้อย/เน้นตรวจเอกสาร)</p>

        <div class="space-y-6">
          ${q.items.map(item => renderRubricItem(item.id, item.name, item.desc, item.rubrics, [3, 2, 1])).join('')}
        </div>

        <div class="mt-8 pt-6 border-t border-slate-100">
          <label class="block text-sm font-bold text-slate-700 mb-2">ตอนที่ 3 : ข้อเสนอแนะเพื่อการพัฒนา / Action Plan</label>
          <textarea id="form-supervisor-notes" rows="3" placeholder="ระบุข้อค้นพบ คำแนะนำ หรือข้อตกลงร่วมกับสถานศึกษา..." class="w-full bg-slate-50 border border-slate-300 rounded-xl p-4 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500"></textarea>
        </div>
      </div>
    `;
  }

  function renderSchoolForm(q) {
    return `
      <!-- Part 1 -->
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-3 border-b border-slate-100 mb-6 flex items-center gap-2">
          <i class="fas fa-clipboard-list text-amber-600"></i>
          <span>${q.part1.title}</span>
        </h3>
        <p class="text-xs text-slate-500 mb-6">เกณฑ์คะแนน: 3 = ดีมาก (สม่ำเสมอ/ประจักษ์ชัด), 2 = พอใช้ (ทำตามแผนบางส่วน), 1 = ควรปรับปรุง (ยังไม่ชัดเจน)</p>

        <div class="space-y-6">
          ${q.part1.items.map(item => renderRubricItem(item.id, item.name, item.desc, { 3: item.r3, 2: item.r2, 1: item.r1 }, [3, 2, 1])).join('')}
        </div>
      </div>

      <!-- Part 2 -->
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-3 border-b border-slate-100 mb-6 flex items-center gap-2">
          <i class="fas fa-cubes text-amber-600"></i>
          <span>${q.part2.title}</span>
        </h3>
        <p class="text-xs text-slate-500 mb-6">เกณฑ์คะแนน: 3 = ดีมาก, 2 = พอใช้, 1 = ควรปรับปรุง</p>

        <div class="space-y-6">
          ${q.part2.items.map(item => renderRubricItem(item.id, item.name, item.desc, { 3: item.r3, 2: item.r2, 1: item.r1 }, [3, 2, 1])).join('')}
        </div>
      </div>

      <!-- Part 3: Reflections -->
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-3 border-b border-slate-100 mb-6 flex items-center gap-2">
          <i class="fas fa-lightbulb text-amber-600"></i>
          <span>ส่วนที่ 3 : บันทึกการสะท้อนคิดเพื่อการพัฒนา</span>
        </h3>
        <div class="space-y-5">
          ${q.reflections.map(r => `
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1.5">${r.label}</label>
              <textarea id="form-ref-${r.id}" rows="2" placeholder="ระบุข้อความ..." class="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500"></textarea>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderTeacherForm(q) {
    return `
      ${q.elements.map((elem, idx) => `
        <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
          <h3 class="text-base md:text-lg font-bold text-slate-800 pb-3 border-b border-slate-100 mb-6 flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">${idx + 1}</span>
            <span>${elem.name}</span>
          </h3>

          <div class="space-y-6">
            ${elem.items.map(item => renderRubricItem(item.id, item.name, item.desc, { 3: item.r3, 2: item.r2, 1: item.r1 }, [3, 2, 1])).join('')}
          </div>
        </div>
      `).join('')}

      <!-- Reflection after teaching -->
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-3 border-b border-slate-100 mb-6 flex items-center gap-2">
          <i class="fas fa-comment-dots text-emerald-600"></i>
          <span>ส่วนที่ 2 : แบบบันทึกการสะท้อนผลหลังจัดกิจกรรม</span>
        </h3>
        <div class="space-y-4">
          ${q.postReflection.map(r => `
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1.5">${r.label}</label>
              <textarea id="form-ref-${r.id}" rows="2" placeholder="ระบุข้อคิดเห็น..." class="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500"></textarea>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderStudentForm(q, level) {
    return `
      ${q.domains.map(dom => `
        <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
          <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 mb-6">
            <div>
              <span class="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">${dom.group}</span>
              <h3 class="text-lg font-bold text-slate-800 mt-1">${dom.name}</h3>
            </div>
          </div>

          <div class="space-y-6">
            ${dom.items.map(item => renderRubricItem(item.id, item.name, item.desc, { 3: item.r3, 2: item.r2, 1: item.r1, 0: item.r0 }, [3, 2, 1, 0])).join('')}
          </div>
        </div>
      `).join('')}
    `;
  }

  function renderParentForm(q, level) {
    return `
      <!-- Part 1: Parent Support -->
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-2 flex items-center gap-2">
          <i class="fas fa-heart text-rose-500"></i>
          <span>${q.part1Title}</span>
        </h3>
        <p class="text-xs text-slate-500 mb-6 pb-3 border-b border-slate-100">${q.part1Desc}</p>

        <div class="space-y-6">
          ${q.part1Items.map(item => renderRubricItem(item.id, item.name, '', {
            3: 'ทุกครั้ง / เสมอ (ปฏิบัติเป็นประจำ)',
            2: 'บ่อยครั้ง / ส่วนใหญ่ (เปิดโอกาสให้ทำเอง)',
            1: 'บางครั้ง (นานๆ ครั้ง/คอยบอก)',
            0: 'ไม่เคย / ไม่เปิดโอกาส (ทำให้ทั้งหมด)'
          }, [3, 2, 1, 0])).join('')}
        </div>
      </div>

      <!-- Part 2: Child Behavior at Home -->
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-2 flex items-center gap-2">
          <i class="fas fa-home text-rose-500"></i>
          <span>${q.part2Title}</span>
        </h3>
        <p class="text-xs text-slate-500 mb-6 pb-3 border-b border-slate-100">${q.part2Desc}</p>

        <div class="space-y-6">
          ${q.part2Items.map(item => renderRubricItem(item.id, item.name, item.domain ? `ทักษะ: ${item.domain}` : '', {
            3: 'ทำเองได้เป็นประจำ (สม่ำเสมอไม่ต้องเตือน)',
            2: 'ทำได้บ่อยแต่ต้องเตือนบ้าง',
            1: 'ทำได้บางครั้ง / ต้องบังคับ',
            0: 'ไม่เคยทำเลย / ผู้ปกครองทำให้'
          }, [3, 2, 1, 0])).join('')}
        </div>
      </div>

      <!-- Part 3: Reflections -->
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200">
        <h3 class="text-lg font-bold text-slate-800 pb-3 border-b border-slate-100 mb-6 flex items-center gap-2">
          <i class="fas fa-comment-heart text-rose-500"></i>
          <span>ส่วนที่ 3 : ความคิดเห็นและเสียงสะท้อนจากใจผู้ปกครอง</span>
        </h3>
        <div class="space-y-5">
          ${q.reflections.map(r => `
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1.5">${r.label}</label>
              <textarea id="form-ref-${r.id}" rows="2" placeholder="เขียนสะท้อนมุมมอง ความรู้สึกของท่าน..." class="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500"></textarea>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // --- OPTIONAL ATTACHMENT SECTION (สำหรับ ศึกษานิเทศก์, โรงเรียน, และครูผู้สอน) ---
  // บันทึกไฟล์ลง Google Drive Folder ID: 1nhD1UI4lE6Dox1VrFvKKDS9LbqqV_Y4I
  function renderAttachmentSection(formType) {
    if (!['supervisor', 'school', 'teacher', 'teacher_early', 'teacher_primary'].includes(formType)) {
      return '';
    }

    return `
      <!-- Attachment Upload Section -->
      <div class="academic-card p-6 md:p-8 mb-8 bg-white border border-slate-200 shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 mb-4 gap-2">
          <h3 class="text-base md:text-lg font-bold text-slate-800 flex items-center gap-2">
            <i class="fas fa-paperclip text-blue-600"></i>
            <span>เอกสารแนบ / ภาพถ่ายร่องรอยการปฏิบัติงาน</span>
          </h3>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold w-fit">
            ไม่บังคับ (Optional)
          </span>
        </div>
        <p class="text-xs text-slate-500 mb-4 leading-relaxed">
          ท่านสามารถแนบไฟล์เอกสารร่องรอย เช่น แผนการจัดประสบการณ์/การเรียนรู้, ภาพถ่ายกิจกรรม Active Learning, บันทึกการนิเทศ หรือไฟล์สรุปผล (รองรับไฟล์ PDF, Word, รูปภาพ JPG/PNG ขนาดไม่เกิน 100 MB)
        </p>

        <div class="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-6 text-center bg-slate-50/60 transition cursor-pointer" onclick="document.getElementById('form-attachment-input').click()">
          <input type="file" id="form-attachment-input" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" class="hidden" onchange="window.EF_APP.handleFileSelect(event)">
          
          <div id="attachment-upload-prompt" class="space-y-2">
            <div class="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xl mx-auto shadow-sm">
              <i class="fas fa-cloud-upload-alt"></i>
            </div>
            <div class="text-xs font-bold text-slate-700">คลิกที่นี่เพื่อเลือกไฟล์ หรือลากไฟล์มาวาง</div>
            <div class="text-[11px] text-slate-400">รองรับไฟล์ PDF, DOC, DOCX, JPG, PNG (สูงสุด 100 MB)</div>
          </div>

          <div id="attachment-preview-box" class="hidden text-left bg-white p-3.5 rounded-xl border border-blue-200 items-center justify-between shadow-sm">
            <div class="flex items-center gap-3 min-w-0">
              <div id="attachment-icon" class="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-lg shrink-0">
                <i class="fas fa-file-alt"></i>
              </div>
              <div class="min-w-0">
                <div id="attachment-filename" class="text-xs font-bold text-slate-800 truncate">filename.pdf</div>
                <div id="attachment-filesize" class="text-[10px] text-slate-500">0 KB</div>
              </div>
            </div>
            <button type="button" onclick="event.stopPropagation(); window.EF_APP.removeAttachment();" class="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition" title="ลบไฟล์">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function handleFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const maxSizeBytes = 100 * 1024 * 1024; // 100 MB
    if (file.size > maxSizeBytes) {
      showToast('ไฟล์มีขนาดเกิน 100 MB กรุณาเลือกไฟล์ที่มีขนาดเล็กลง', 'error');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
      state.attachment = {
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        base64: e.target.result
      };

      const promptEl = document.getElementById('attachment-upload-prompt');
      const previewEl = document.getElementById('attachment-preview-box');
      const filenameEl = document.getElementById('attachment-filename');
      const filesizeEl = document.getElementById('attachment-filesize');
      const iconEl = document.getElementById('attachment-icon');

      if (promptEl && previewEl) {
        promptEl.classList.add('hidden');
        previewEl.classList.remove('hidden');
        previewEl.classList.add('flex');
        
        if (filenameEl) filenameEl.textContent = file.name;
        if (filesizeEl) {
          const sizeKb = (file.size / 1024).toFixed(1);
          const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
          filesizeEl.textContent = file.size >= 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;
        }
        if (iconEl) {
          if (file.type.startsWith('image/')) {
            iconEl.innerHTML = '<i class="fas fa-file-image text-emerald-600"></i>';
          } else if (file.type.includes('pdf')) {
            iconEl.innerHTML = '<i class="fas fa-file-pdf text-rose-600"></i>';
          } else if (file.type.includes('word') || file.name.endsWith('.doc') || file.name.endsWith('.docx')) {
            iconEl.innerHTML = '<i class="fas fa-file-word text-blue-600"></i>';
          } else {
            iconEl.innerHTML = '<i class="fas fa-file-alt text-blue-600"></i>';
          }
        }
      }
      showToast(`เลือกไฟล์ "${file.name}" เรียบร้อยแล้ว`, 'info');
    };

    reader.onerror = function() {
      showToast('เกิดข้อผิดพลาดในการอ่านไฟล์', 'error');
    };

    reader.readAsDataURL(file);
  }

  function removeAttachment() {
    state.attachment = null;
    const inputEl = document.getElementById('form-attachment-input');
    if (inputEl) inputEl.value = '';

    const promptEl = document.getElementById('attachment-upload-prompt');
    const previewEl = document.getElementById('attachment-preview-box');
    if (promptEl && previewEl) {
      promptEl.classList.remove('hidden');
      previewEl.classList.add('hidden');
      previewEl.classList.remove('flex');
    }
    showToast('ลบไฟล์แนบแล้ว', 'info');
  }

  function renderRubricItem(id, title, desc, rubrics, scoreLevels) {
    return `
      <div class="p-4 md:p-5 rounded-2xl bg-slate-50/70 border border-slate-200/80 transition" id="item-card-${id}">
        <div class="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-3">
          <div class="flex-1">
            <h4 class="text-sm md:text-base font-bold text-slate-800">${title}</h4>
            ${desc ? `<p class="text-xs text-slate-600 mt-1 font-light leading-relaxed">${desc}</p>` : ''}
          </div>
          
          <!-- Rating Choice Buttons -->
          <div class="flex items-center gap-1.5 shrink-0 self-end md:self-start">
            ${scoreLevels.map(lvl => `
              <button type="button" 
                onclick="window.EF_APP.selectScore('${id}', ${lvl})" 
                id="btn-score-${id}-${lvl}" 
                class="rubric-btn w-11 h-11 text-sm ${scoreLevels.length === 4 ? 'w-10 h-10' : 'w-12 h-11'}">
                <span>${lvl}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Selected Rubric Description Preview Card -->
        <div id="desc-box-${id}" class="rubric-desc-box hidden mt-3">
          <div class="text-xs text-slate-700" id="desc-text-${id}"></div>
        </div>
      </div>
    `;
  }

  // --- SCORE SELECTION LOGIC ---
  function selectScore(itemId, score) {
    state.formAnswers[itemId] = score;

    // Update active button styling
    const card = document.getElementById(`item-card-${itemId}`);
    if (card) {
      card.querySelectorAll('.rubric-btn').forEach(b => {
        b.classList.remove('active', 'active-3', 'active-2', 'active-1', 'active-0');
      });
      const activeBtn = document.getElementById(`btn-score-${itemId}-${score}`);
      if (activeBtn) {
        activeBtn.classList.add('active', `active-${score}`);
      }

      // Show rubric description
      const descBox = document.getElementById(`desc-box-${itemId}`);
      const descText = document.getElementById(`desc-text-${itemId}`);
      if (descBox && descText) {
        const rubricText = findRubricText(itemId, score);
        if (rubricText) {
          descText.innerHTML = `<strong>ระดับ ${score}:</strong> ${rubricText}`;
          descBox.classList.remove('hidden');
        }
      }
    }

    calculateLiveScores();
  }

  function findRubricText(itemId, score) {
    const q = window.EF_QUESTIONS;
    const t = state.activeFormType;

    if (t === 'supervisor') {
      const item = q.supervisor.items.find(i => i.id == itemId);
      return item && item.rubrics ? item.rubrics[score] : '';
    } else if (t === 'school') {
      let item = q.school.part1.items.find(i => i.id === itemId);
      if (!item) item = q.school.part2.items.find(i => i.id === itemId);
      if (item) return score === 3 ? item.r3 : score === 2 ? item.r2 : item.r1;
    } else if (t === 'teacher' || t === 'teacher_early' || t === 'teacher_primary') {
      for (const elem of q.teacher.elements) {
        const item = elem.items.find(i => i.id === itemId);
        if (item) return score === 3 ? item.r3 : score === 2 ? item.r2 : item.r1;
      }
    } else if (t === 'student_early') {
      for (const dom of q.student.early.domains) {
        const item = dom.items.find(i => i.id === itemId);
        if (item) return score === 3 ? item.r3 : score === 2 ? item.r2 : score === 1 ? item.r1 : item.r0;
      }
    } else if (t === 'student_primary') {
      for (const dom of q.student.primary.domains) {
        const item = dom.items.find(i => i.id === itemId);
        if (item) return score === 3 ? item.r3 : score === 2 ? item.r2 : score === 1 ? item.r1 : item.r0;
      }
    }
    return '';
  }

  function calculateLiveScores() {
    const scores = Object.values(state.formAnswers);
    if (scores.length === 0) return;

    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = sum / scores.length;

    const totalEl = document.getElementById('live-total-score');
    const avgEl = document.getElementById('live-avg-score');
    const qualityEl = document.getElementById('live-quality-level');

    if (totalEl) totalEl.textContent = sum;
    if (avgEl) avgEl.textContent = avg.toFixed(2);
    if (qualityEl) {
      let label = 'กำลังประเมิน...';
      let colorClass = 'text-slate-700';

      const t = state.activeFormType;
      if (t === 'supervisor' || t === 'school' || t === 'teacher') {
        if (avg >= 2.5) { label = 'ระดับดีมาก / ยั่งยืน'; colorClass = 'text-emerald-600'; }
        else if (avg >= 1.8) { label = 'ระดับพอใช้ / กำลังพัฒนา'; colorClass = 'text-blue-600'; }
        else { label = 'ระดับควรปรับปรุง / หนุนเสริมเร่งด่วน'; colorClass = 'text-amber-600'; }
      } else {
        if (avg >= 2.5) { label = 'ก้าวหน้าและเป็นอิสระ (ดีมาก)'; colorClass = 'text-emerald-600'; }
        else if (avg >= 1.5) { label = 'กำลังเติบโตและปรับตัว (พอใช้)'; colorClass = 'text-blue-600'; }
        else { label = 'จุดเริ่มต้นของการหนุนเสริม'; colorClass = 'text-amber-600'; }
      }

      qualityEl.className = `text-base font-bold ${colorClass} mt-2`;
      qualityEl.textContent = label;
    }
  }

  function onTeacherStageChange(stage) {
    const container = document.getElementById('form-teacher-grade-container');
    if (!container) return;
    if (stage === 'early') {
      container.innerHTML = `
        <label class="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้นที่ตนเองรับผิดชอบ/จัดการเรียนการสอน <span class="text-rose-500">*</span></label>
        <select id="form-grade-level" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
          <option value="a1">1. ชั้นอนุบาล 1</option>
          <option value="a2">2. ชั้นอนุบาล 2</option>
          <option value="a3">3. ชั้นอนุบาล 3</option>
          <option value="multi_early">4. สอนรวมชั้น/หลายชั้น</option>
        </select>
      `;
    } else {
      container.innerHTML = `
        <label class="block text-xs font-bold text-slate-700 mb-1.5">ระดับชั้นที่ตนเองรับผิดชอบ/จัดการเรียนการสอน <span class="text-rose-500">*</span></label>
        <select id="form-grade-level" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
          <option value="p1">1. ชั้น ป.1</option>
          <option value="p2">2. ชั้น ป.2</option>
          <option value="p3">3. ชั้น ป.3</option>
          <option value="multi_primary">4. สอนรวมชั้น/หลายชั้น</option>
        </select>
      `;
    }
  }

  // --- FORM SUBMIT HANDLER ---
  async function handleFormSubmit(e) {
    e.preventDefault();

    const schoolSel = document.getElementById('form-school-select');
    if (!schoolSel || !schoolSel.value) {
      showToast('กรุณาเลือกโรงเรียน', 'error');
      return;
    }

    const school = window.NAN1_SCHOOLS.find(s => s.id === schoolSel.value);
    if (!school) {
      showToast('ไม่พบข้อมูลโรงเรียน', 'error');
      return;
    }

    const scores = Object.values(state.formAnswers);
    if (scores.length === 0) {
      showToast('กรุณาตอบคำถามในแบบประเมิน', 'error');
      return;
    }

    const submitBtn = document.getElementById('btn-submit-eval');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังบันทึกข้อมูล...';
    }

    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = Number((sum / scores.length).toFixed(2));
    const dateVal = (document.getElementById('form-eval-date') || {}).value || getThaiDateISO();

    const evaluatorName = (document.getElementById('form-evaluator-name') || {}).value || 'ไม่ระบุ';
    const recipientName = (document.getElementById('form-recipient-name') || {}).value || '';
    const studentName = (document.getElementById('form-student-name') || {}).value || '';
    const parentName = (document.getElementById('form-parent-name') || {}).value || '';

    const gradeLevelSelect = document.getElementById('form-grade-level');
    const gradeLevel = gradeLevelSelect ? gradeLevelSelect.value : '';
    const gradeLevelName = gradeLevelSelect && gradeLevelSelect.options[gradeLevelSelect.selectedIndex] ? gradeLevelSelect.options[gradeLevelSelect.selectedIndex].text : '';

    let teachingStage = '';
    const teacherStageEl = document.getElementById('form-teacher-stage');
    if (teacherStageEl) {
      teachingStage = teacherStageEl.value;
    } else if (state.activeFormType.includes('early')) {
      teachingStage = 'early';
    } else if (state.activeFormType.includes('primary')) {
      teachingStage = 'primary';
    }

    let quality = 'ระดับพอใช้';
    if (avg >= 2.5) quality = 'ระดับดีมาก / ก้าวหน้า';
    else if (avg < 1.5) quality = 'ระดับควรปรับปรุง';

    // 1. Collect any text reflection answers (best practice, challenges, reflections)
    document.querySelectorAll('textarea[id^="form-ref-"]').forEach(tx => {
      const refKey = tx.id.replace('form-ref-', '');
      if (tx.value && tx.value.trim()) {
        state.formAnswers[refKey] = tx.value.trim();
      }
    });

    // Save stage and grade metadata into answers as permanent fail-safe
    if (teachingStage) {
      state.formAnswers._meta_stage = teachingStage;
      state.formAnswers._meta_grade = gradeLevel;
      state.formAnswers._meta_grade_name = gradeLevelName;
    }

    // 2. Generate explicit instrument prefix for submission ID
    let idPrefix = 'SUB-SCH-';
    if (state.activeFormType === 'supervisor') idPrefix = 'SUB-SUP-';
    else if (state.activeFormType === 'school') idPrefix = 'SUB-SCH-';
    else if (state.activeFormType === 'teacher_early' || (state.activeFormType === 'teacher' && teachingStage === 'early')) idPrefix = 'SUB-TCHE-';
    else if (state.activeFormType === 'teacher_primary' || (state.activeFormType === 'teacher' && teachingStage === 'primary')) idPrefix = 'SUB-TCHP-';
    else if (state.activeFormType === 'teacher') idPrefix = 'SUB-TCH-';
    else if (state.activeFormType === 'student_early') idPrefix = 'SUB-STE-';
    else if (state.activeFormType === 'student_primary') idPrefix = 'SUB-STP-';
    else if (state.activeFormType === 'parent_early') idPrefix = 'SUB-PAE-';
    else if (state.activeFormType === 'parent_primary') idPrefix = 'SUB-PAP-';

    const subId = idPrefix + Date.now();

    const submissionPayload = {
      id: subId,
      type: state.activeFormType === 'teacher_early' || state.activeFormType === 'teacher_primary' ? 'teacher' : state.activeFormType,
      typeName: getFormTypeName(state.activeFormType, teachingStage),
      teachingStage: teachingStage,
      gradeLevel: gradeLevel,
      gradeLevelName: gradeLevelName,
      teacherLevel: teachingStage === 'early' ? 'ปฐมวัย' : (teachingStage === 'primary' ? 'ประถม' : ''),
      schoolId: school.id,
      schoolName: school.name,
      schoolGroup: school.group,
      district: school.district,
      date: dateVal,
      scoreTotal: sum,
      scoreAvg: avg,
      qualityLevel: quality,
      evaluator: evaluatorName || parentName || 'ไม่ระบุ',
      recipientName: recipientName,
      studentName: studentName || (recipientName ? recipientName + ' (ผู้รับการนิเทศ)' : ''),
      answers: state.formAnswers,
      domainScores: (function() {
        const keys = ['wm', 'ic', 'sh', 'fo', 'ec', 'sm', 'in', 'po', 'gp'];
        const scoresObj = {};
        let hasAny = false;
        keys.forEach(k => {
          const matched = Object.entries(state.formAnswers)
            .filter(([qId]) => qId.includes(`_${k}_`) || qId.includes(`_${k}`))
            .map(([, sc]) => Number(sc))
            .filter(v => !isNaN(v));
          if (matched.length > 0) {
            scoresObj[k] = Number((matched.reduce((a, b) => a + b, 0) / matched.length).toFixed(2));
            hasAny = true;
          } else {
            scoresObj[k] = avg;
          }
        });
        return hasAny ? scoresObj : null;
      })(),
      attachment: state.attachment ? {
        name: state.attachment.name,
        size: state.attachment.size,
        type: state.attachment.type,
        base64: state.attachment.base64
      } : null,
      submittedAt: getThaiDateTimeISO()
    };

    // Save locally (store attachment metadata without heavy base64 to avoid quota issues)
    const localPayload = {
      ...submissionPayload,
      attachment: state.attachment ? {
        name: state.attachment.name,
        size: state.attachment.size,
        type: state.attachment.type
      } : null
    };
    state.submissions.unshift(localPayload);
    try {
      localStorage.setItem(STORAGE_KEY_SUBMISSIONS, JSON.stringify(state.submissions));
    } catch (err) {
      console.warn('Storage quota exceeded or error', err);
    }

    // Optional: Send to Google Apps Script Endpoint
    if (state.googleScriptUrl) {
      try {
        await fetch(state.googleScriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submissionPayload)
        });
      } catch (err) {
        console.log('GAS POST attempted', err);
      }
    }

    // Confetti effect
    if (window.confetti) {
      window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
    }

    showToast('บันทึกข้อมูลการประเมินสำเร็จเรียบร้อยแล้ว!', 'success');

    // Show Confirmation & Audit Receipt Modal immediately
    openSubmissionConfirmationModal(submissionPayload, school);
  }

  function getFormTypeName(t, stage) {
    switch (t) {
      case 'supervisor': return 'แบบประเมินสำหรับศึกษานิเทศก์';
      case 'school': return 'แบบประเมินสถานศึกษา';
      case 'teacher_early': return 'แบบนิเทศครูปฐมวัย (อ.1-3)';
      case 'teacher_primary': return 'แบบนิเทศครูประถม (สุขศึกษา/พลฯ)';
      case 'teacher':
        if (stage === 'early') return 'แบบนิเทศครูปฐมวัย (อ.1-3)';
        if (stage === 'primary') return 'แบบนิเทศครูประถม (สุขศึกษา/พลฯ)';
        return 'แบบนิเทศครูผู้สอน';
      case 'student_early': return 'แบบประเมินเด็กปฐมวัย (ครู)';
      case 'student_primary': return 'แบบประเมินเด็กประถม (ครู)';
      case 'parent_early': return 'แบบประเมินผู้ปกครองปฐมวัย';
      case 'parent_primary': return 'แบบประเมินผู้ปกครองประถม';
      default: return 'แบบประเมิน EF';
    }
  }

  function getQuestionDetail(formType, questionId) {
    if (!window.EF_QUESTIONS) return { name: 'ข้อคำถามที่ ' + questionId, desc: '', rubrics: {} };
    
    let allItems = [];
    
    function collectFromInstrument(obj) {
      if (!obj) return;
      if (Array.isArray(obj.items)) allItems.push(...obj.items);
      if (obj.part1 && Array.isArray(obj.part1.items)) allItems.push(...obj.part1.items);
      if (obj.part2 && Array.isArray(obj.part2.items)) allItems.push(...obj.part2.items);
      if (Array.isArray(obj.elements)) {
        obj.elements.forEach(el => {
          if (Array.isArray(el.items)) allItems.push(...el.items);
        });
      }
      if (Array.isArray(obj.domains)) {
        obj.domains.forEach(d => {
          if (Array.isArray(d.items)) allItems.push(...d.items);
        });
      }
      if (Array.isArray(obj.reflections)) {
        obj.reflections.forEach(r => allItems.push({ id: r.id, name: r.label, desc: 'บันทึกสะท้อนคิด' }));
      }
      if (Array.isArray(obj.postReflection)) {
        obj.postReflection.forEach(r => allItems.push({ id: r.id, name: r.label, desc: 'บันทึกสะท้อนคิด' }));
      }
    }

    if (formType === 'student_early' && window.EF_QUESTIONS.student?.early) {
      collectFromInstrument(window.EF_QUESTIONS.student.early);
    } else if (formType === 'student_primary' && window.EF_QUESTIONS.student?.primary) {
      collectFromInstrument(window.EF_QUESTIONS.student.primary);
    } else if (formType === 'parent_early' && window.EF_QUESTIONS.parent?.early) {
      collectFromInstrument(window.EF_QUESTIONS.parent.early);
    } else if (formType === 'parent_primary' && window.EF_QUESTIONS.parent?.primary) {
      collectFromInstrument(window.EF_QUESTIONS.parent.primary);
    } else if (window.EF_QUESTIONS[formType]) {
      collectFromInstrument(window.EF_QUESTIONS[formType]);
    } else {
      collectFromInstrument(window.EF_QUESTIONS.supervisor);
      collectFromInstrument(window.EF_QUESTIONS.school);
      collectFromInstrument(window.EF_QUESTIONS.teacher);
      if (window.EF_QUESTIONS.student) {
        collectFromInstrument(window.EF_QUESTIONS.student.early);
        collectFromInstrument(window.EF_QUESTIONS.student.primary);
      }
      if (window.EF_QUESTIONS.parent) {
        collectFromInstrument(window.EF_QUESTIONS.parent.early);
        collectFromInstrument(window.EF_QUESTIONS.parent.primary);
      }
    }
    
    const found = allItems.find(it => String(it.id) === String(questionId));
    if (found) {
      const rubrics = found.rubrics || {
        3: found.r3 || '',
        2: found.r2 || '',
        1: found.r1 || '',
        0: found.r0 || ''
      };
      return {
        id: found.id,
        name: found.name || ('ข้อคำถามที่ ' + questionId),
        desc: found.desc || '',
        rubrics: rubrics
      };
    }
    return { name: 'ข้อคำถามที่ ' + questionId, desc: '', rubrics: {} };
  }

  function openSubmissionConfirmationModal(payload, school) {
    const existing = document.getElementById('submission-confirmation-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'submission-confirmation-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto animate-fade-in';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-200 text-center my-auto">
        <div class="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl font-bold mx-auto mb-4 shadow-lg shadow-emerald-500/20">
          <i class="fas fa-check-circle"></i>
        </div>

        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 mb-2">
          <i class="fas fa-file-signature"></i> บันทึกข้อมูลการประเมินสำเร็จ
        </span>
        <h3 class="text-xl font-bold text-slate-800 mb-1">ใบยืนยันการส่งข้อมูลการประเมิน</h3>
        <p class="text-xs text-slate-500 mb-5 font-mono">รหัสอ้างอิง: <strong class="text-blue-700 select-all">${payload.id}</strong></p>

        <div class="bg-slate-50 rounded-xl p-4 border border-slate-200 text-left space-y-2.5 text-xs text-slate-700 mb-6">
          <div class="flex justify-between border-b border-slate-200/60 pb-1.5">
            <span class="text-slate-500">สถานศึกษา:</span>
            <strong class="text-slate-900 text-right">${payload.schoolName}</strong>
          </div>
          <div class="flex justify-between border-b border-slate-200/60 pb-1.5">
            <span class="text-slate-500">ประเภทแบบประเมิน:</span>
            <strong class="text-blue-800 text-right">${payload.typeName}</strong>
          </div>
          <div class="flex justify-between border-b border-slate-200/60 pb-1.5">
            <span class="text-slate-500">ผู้ประเมิน:</span>
            <strong class="text-slate-900 text-right">${payload.evaluator || '-'}</strong>
          </div>
          ${payload.recipientName || payload.studentName ? `
            <div class="flex justify-between border-b border-slate-200/60 pb-1.5">
              <span class="text-slate-500">ผู้รับการนิเทศ / นักเรียน:</span>
              <strong class="text-slate-900 text-right">${payload.recipientName || payload.studentName}</strong>
            </div>
          ` : ''}
          ${payload.gradeLevelName ? `
            <div class="flex justify-between border-b border-slate-200/60 pb-1.5">
              <span class="text-slate-500">ระดับชั้น:</span>
              <strong class="text-slate-900 text-right">${payload.gradeLevelName}</strong>
            </div>
          ` : ''}
          <div class="flex justify-between pt-1">
            <span class="text-slate-500 font-semibold">คะแนนเฉลี่ย / ระดับคุณภาพ:</span>
            <strong class="text-emerald-700 text-right font-bold text-sm">${payload.scoreAvg.toFixed(2)} / 3.00 (${payload.qualityLevel})</strong>
          </div>
        </div>

        <div class="space-y-2.5">
          <button onclick="document.getElementById('submission-confirmation-modal').remove(); window.EF_APP.viewSubmissionDetail('${payload.id}');" class="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-2">
            <i class="fas fa-search-plus"></i>
            <span>ตรวจสอบคำตอบย้อนหลังรายข้อ (Check & Audit Answers)</span>
          </button>

          <div class="grid grid-cols-2 gap-2">
            <button onclick="document.getElementById('submission-confirmation-modal').remove(); window.EF_APP.viewSchoolReport('${payload.schoolId}');" class="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition flex items-center justify-center gap-1.5">
              <i class="fas fa-file-invoice text-blue-600"></i>
              <span>ดูรายงานโรงเรียนนี้</span>
            </button>
            <button onclick="document.getElementById('submission-confirmation-modal').remove(); window.EF_APP.openForm('${payload.type}', '${payload.schoolId}');" class="py-2.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold text-xs transition flex items-center justify-center gap-1.5">
              <i class="fas fa-plus-circle"></i>
              <span>ทำรายการถัดไป</span>
            </button>
          </div>

          <button onclick="document.getElementById('submission-confirmation-modal').remove(); window.EF_APP.navigate('home');" class="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-semibold">
            กลับสู่หน้าหลัก
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function openSubmissionDetailModal(subId) {
    const sub = (state.submissions || []).find(s => s.id === subId);
    if (!sub) {
      showToast('ไม่พบข้อมูลการประเมินนี้', 'error');
      return;
    }

    const existing = document.getElementById('submission-detail-modal');
    if (existing) existing.remove();

    const answers = sub.answers || {};
    const answerEntries = Object.entries(answers);

    const modal = document.createElement('div');
    modal.id = 'submission-detail-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto animate-fade-in';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto">
        <!-- Modal Header -->
        <div class="p-6 bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 text-white flex items-center justify-between shrink-0">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-slate-950">
                <i class="fas fa-search mr-1"></i> ตรวจสอบข้อมูลย้อนหลัง
              </span>
              <span class="text-xs font-mono text-blue-200">${sub.id}</span>
            </div>
            <h3 class="text-xl font-bold text-white">${sub.typeName}</h3>
            <p class="text-xs text-blue-200">${sub.schoolName} (${sub.schoolGroup} • ${sub.district})</p>
          </div>
          <button onclick="document.getElementById('submission-detail-modal').remove()" class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          <!-- Summary Cards -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span class="text-slate-500 block text-[11px]">ผู้ประเมิน</span>
              <strong class="text-slate-800 text-sm block mt-0.5 truncate">${sub.evaluator || '-'}</strong>
            </div>
            <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span class="text-slate-500 block text-[11px]">ผู้รับการประเมิน/นักเรียน</span>
              <strong class="text-slate-800 text-sm block mt-0.5 truncate">${sub.recipientName || sub.studentName || '-'}</strong>
            </div>
            <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span class="text-slate-500 block text-[11px]">ระดับชั้น</span>
              <strong class="text-slate-800 text-sm block mt-0.5 truncate">${sub.gradeLevelName || '-'}</strong>
            </div>
            <div class="p-3.5 rounded-xl bg-blue-50 border border-blue-200">
              <span class="text-blue-700 block text-[11px]">คะแนนเฉลี่ย / ระดับ</span>
              <strong class="text-blue-900 text-sm block mt-0.5">${(Number(sub.scoreAvg) || 0).toFixed(2)} / 3.00</strong>
              <span class="text-[10px] text-blue-600 font-semibold">${sub.qualityLevel || '-'}</span>
            </div>
          </div>

          <!-- Date & Time Information -->
          <div class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-amber-50/70 border border-amber-200/70 text-amber-900 text-[11px]">
            <div><i class="fas fa-calendar-alt text-amber-600 mr-1.5"></i> วันที่ประเมิน: <strong>${formatThaiDate(sub.date, 'long')}</strong> (${sub.date})</div>
            <div><i class="fas fa-clock text-amber-600 mr-1.5"></i> เวลาที่บันทึกระบบ (เวลาไทย): <strong>${formatThaiDateTime(sub.submittedAt || sub.date)}</strong></div>
          </div>

          <!-- Attachment Information (If any) -->
          ${sub.attachment ? (() => {
            const att = sub.attachment;
            const attUrl = sub.attachmentUrl || att.url || '';
            const attName = att.name || 'เอกสารแนบร่องรอย';
            const rawType = (att.type || '').toLowerCase();
            const nameLower = attName.toLowerCase();
            const isImg = rawType.startsWith('image/') || nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') || nameLower.endsWith('.png') || nameLower.endsWith('.webp') || (att.base64 && att.base64.startsWith('data:image/'));
            const isPdf = rawType.includes('pdf') || nameLower.endsWith('.pdf');
            const isDoc = rawType.includes('word') || nameLower.endsWith('.doc') || nameLower.endsWith('.docx');
            const displaySize = att.size ? (att.size >= 1024 * 1024 ? (att.size / (1024*1024)).toFixed(2) + ' MB' : (att.size / 1024).toFixed(1) + ' KB') : 'ไฟล์แนบร่องรอย';
            const fileId = extractDriveFileId(attUrl);
            const directUrl = attUrl || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '#');
            const downloadUrl = fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : directUrl;
            const thumbUrl = isImg ? (att.base64 || (fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w800` : directUrl)) : '';

            return `
              <div class="p-4 rounded-2xl bg-gradient-to-r from-blue-50/80 to-indigo-50/60 border border-blue-200 shadow-sm space-y-3">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="w-14 h-14 rounded-xl overflow-hidden bg-white border border-blue-200 flex items-center justify-center shrink-0 shadow-sm cursor-pointer" onclick="window.EF_APP.openMediaLightbox('${sub.id}')">
                      ${isImg && thumbUrl ? `
                        <img src="${thumbUrl}" alt="${attName}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-image text-blue-600 text-xl\\'></i>'">
                      ` : `
                        <i class="${isPdf ? 'fas fa-file-pdf text-rose-600 text-2xl' : isDoc ? 'fas fa-file-word text-blue-600 text-2xl' : 'fas fa-paperclip text-blue-600 text-2xl'}"></i>
                      `}
                    </div>
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 mb-0.5">
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isImg ? 'bg-emerald-100 text-emerald-800' : isPdf ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'}">
                          <i class="${isImg ? 'fas fa-image' : isPdf ? 'fas fa-file-pdf' : 'fas fa-file-alt'} mr-1"></i>
                          ${isImg ? 'รูปภาพร่องรอยกิจกรรม' : isPdf ? 'เอกสาร PDF' : 'ไฟล์เอกสาร'}
                        </span>
                        <span class="text-[10px] text-slate-500 font-mono">${displaySize}</span>
                      </div>
                      <span class="text-xs font-bold text-slate-900 block truncate" title="${attName}">${attName}</span>
                    </div>
                  </div>

                  <span class="text-[11px] text-emerald-700 font-bold px-2.5 py-1 bg-emerald-100 rounded-lg border border-emerald-200 shrink-0 self-start sm:self-center">
                    <i class="fas fa-check-circle mr-1"></i> อัปโหลดสมบูรณ์
                  </span>
                </div>

                <!-- Action Buttons for Report & Viewing -->
                <div class="pt-2 border-t border-blue-100 flex flex-wrap items-center gap-2">
                  <button type="button" onclick="window.EF_APP.openMediaLightbox('${sub.id}')" class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition">
                    <i class="fas fa-search-plus"></i>
                    <span>เปิดดูภาพ/เอกสารเต็มจอ</span>
                  </button>

                  <button type="button" onclick="window.EF_APP.copyMediaUrl('${directUrl}')" class="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs flex items-center gap-1.5 transition" title="คัดลอกลิงก์ไฟล์สำหรับใส่ในเล่มรายงาน/SAR">
                    <i class="fas fa-copy text-amber-500"></i>
                    <span>คัดลอกลิงก์</span>
                  </button>

                  ${directUrl && directUrl !== '#' ? `
                    <a href="${directUrl}" target="_blank" class="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-blue-700 border border-blue-200 font-bold text-xs flex items-center gap-1.5 transition">
                      <i class="fab fa-google-drive"></i>
                      <span>เปิดใน Google Drive</span>
                    </a>
                  ` : ''}

                  <a href="${downloadUrl}" target="_blank" download="${attName}" class="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold text-xs flex items-center gap-1.5 transition">
                    <i class="fas fa-download"></i>
                    <span>ดาวน์โหลด</span>
                  </a>
                </div>
              </div>
            `;
          })() : ''}

          <!-- Question-by-Question Audit Table -->
          <div>
            <h4 class="text-sm font-bold text-slate-800 mb-2.5 flex items-center justify-between">
              <span><i class="fas fa-list-check text-blue-600 mr-1.5"></i> รายละเอียดคะแนนและคำตอบรายข้อ (${answerEntries.length} ข้อ)</span>
              <span class="text-xs font-normal text-slate-500">คะแนนเต็ม 3.00 ต่อข้อ</span>
            </h4>

            <div class="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th class="p-3 w-12 text-center">ข้อ</th>
                    <th class="p-3">ประเด็นการประเมิน / พฤติกรรม</th>
                    <th class="p-3 w-28 text-center">ระดับคะแนนที่ได้</th>
                    <th class="p-3 w-56">เกณฑ์ที่ตรงตามคำตอบ</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${answerEntries.length > 0 ? answerEntries.map(([qId, score]) => {
                    const qDetail = getQuestionDetail(sub.type, qId);
                    const rubricText = (qDetail.rubrics && qDetail.rubrics[score]) ? qDetail.rubrics[score] : '-';
                    return `
                      <tr class="hover:bg-slate-50">
                        <td class="p-3 text-center font-bold text-slate-600">${qId}</td>
                        <td class="p-3">
                          <strong class="text-slate-800 block">${qDetail.name || 'ข้อ ' + qId}</strong>
                          ${qDetail.desc ? `<p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">${qDetail.desc}</p>` : ''}
                        </td>
                        <td class="p-3 text-center">
                          <span class="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-bold ${
                            score === 3 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                            score === 2 ? 'bg-blue-100 text-blue-800 border border-blue-300' :
                            score === 1 ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                            'bg-slate-100 text-slate-600'
                          }">
                            ${score} คะแนน
                          </span>
                        </td>
                        <td class="p-3 text-[11px] text-slate-600 leading-relaxed">
                          ${rubricText}
                        </td>
                      </tr>
                    `;
                  }).join('') : `
                    <tr>
                      <td colspan="4" class="p-4 text-center text-slate-400">ไม่มีข้อมูลคำตอบรายข้อ</td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            <button onclick="window.EF_APP.deleteSubmission('${sub.id}')" class="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 text-xs font-bold flex items-center gap-1.5 transition">
              <i class="fas fa-trash-alt"></i>
              <span>ลบรายการนี้ (กรณีบันทึกผิดพลาด)</span>
            </button>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="window.print()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5 transition">
              <i class="fas fa-print"></i> พิมพ์เอกสารนี้
            </button>
            <button onclick="document.getElementById('submission-detail-modal').remove()" class="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition">
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  async function deleteSubmission(subId, schoolIdContext = null) {
    if (!subId) return;

    // Find the item before deleting to know its school/evaluator for friendly message
    const targetItem = (state.submissions || []).find(s => s.id === subId);
    const label = targetItem ? `${targetItem.typeName} (${targetItem.evaluator || targetItem.schoolName})` : subId;

    if (!confirm(`ยืนยันการลบรายการ "${label}" (รหัส ${subId}) ใช่หรือไม่?\n\n* ข้อมูลจะถูกลบออกจากฐานข้อมูล Google Sheet และปรับปรุงผลคะแนนรายงานทันที`)) {
      return;
    }

    // 1. Add to persistent deleted blacklist immediately
    addDeletedSubmissionId(subId);

    // 2. Filter local memory state
    state.submissions = state.submissions.filter(s => s.id !== subId);
    try {
      localStorage.setItem(STORAGE_KEY_SUBMISSIONS, JSON.stringify(state.submissions));
    } catch (e) {
      console.warn(e);
    }

    showToast(`กำลังลบข้อมูลรหัส ${subId} ออกจากฐานข้อมูล...`, 'info');

    // 3. Send async delete command to Google Apps Script Backend (both GET and POST fallback)
    if (state.googleScriptUrl) {
      (async () => {
        try {
          const deleteUrl = `${state.googleScriptUrl}?action=delete_submission&id=${encodeURIComponent(subId)}`;
          const res = await fetch(deleteUrl);
          const resJson = await res.json();
          if (resJson && resJson.status === 'success') {
            showToast(`ลบข้อมูลรหัส ${subId} ออกจาก Google Sheet สำเร็จแล้ว`, 'success');
          } else {
            // Also try POST mode fallback
            await fetch(state.googleScriptUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'delete_submission', id: subId })
            });
            showToast(`ลบข้อมูลรหัส ${subId} เรียบร้อยแล้ว`, 'success');
          }
        } catch (gasErr) {
          console.warn('Backend GAS delete request notice:', gasErr);
          // Try POST fallback
          try {
            await fetch(state.googleScriptUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'delete_submission', id: subId })
            });
          } catch (e2) {}
          showToast(`ลบข้อมูลในระบบเรียบร้อยแล้ว`, 'success');
        }
      })();
    } else {
      showToast('ลบรายการประเมินเรียบร้อยแล้ว', 'success');
    }

    // 4. Update and refresh active modals if open
    // A. submission-detail-modal
    const detailModal = document.getElementById('submission-detail-modal');
    if (detailModal) detailModal.remove();

    // B. school-progress-modal
    const schId = schoolIdContext || (targetItem ? targetItem.schoolId : null) || (state.activeReportSchool ? state.activeReportSchool.id : null);
    const progressModal = document.getElementById('school-progress-modal');
    if (progressModal && schId) {
      // Re-open/re-render the modal with fresh data
      openSchoolProgressModal(schId);
    }

    // C. school-hub-detail-modal
    const hubModal = document.getElementById('school-hub-detail-modal');
    if (hubModal && schId) {
      openSchoolHubDetailModal(schId);
    }

    // 5. Refresh active main views
    if (state.currentRoute === 'home') renderHomeView();
    else if (state.currentRoute === 'admin') renderAdminView();
    else if (state.currentRoute === 'school-report') renderSchoolReportView();
    else if (state.currentRoute === 'academic-report') renderAcademicReportView();
    else if (state.currentRoute === 'school-hub') renderSchoolHubView();
  }

  // =========================================================================
  // 5. SUPER ADMIN CONTROL CENTER (สำหรับ ศน.พุฒิพงษ์ วงศ์นันท์)
  // =========================================================================
  function renderAdminView() {
    const container = document.getElementById('view-admin');
    if (!container) return;

    if (!state.adminAuth) {
      container.innerHTML = `
        <div class="max-w-md mx-auto my-12 academic-card p-8 bg-white border border-slate-200 text-center shadow-xl">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-700 to-indigo-900 text-white flex items-center justify-center text-2xl font-bold mx-auto mb-4 shadow-lg shadow-blue-500/20">
            <i class="fas fa-user-shield"></i>
          </div>
          <h3 class="text-2xl font-bold text-slate-800 mb-1">ระบบผู้ดูแลระบบ (Admin)</h3>
          <p class="text-xs text-slate-500 mb-6">สำหรับ นายพุฒิพงษ์ วงศ์นันท์ ศึกษานิเทศก์ (โทร. 086-1161126) และคณะทำงาน สพป.น่าน เขต 1</p>

          <form id="admin-login-form" onsubmit="event.preventDefault(); window.EF_APP.handleAdminLogin(event); return false;" class="space-y-4 text-left">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1.5">รหัสผ่านควบคุมระบบ (Passcode)</label>
              <input type="password" id="admin-passcode-input" placeholder="กรอกรหัสผ่านควบคุมระบบ" autofocus
                onkeydown="if(event.key==='Enter'){event.preventDefault(); window.EF_APP.handleAdminLogin(event);}"
                class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
            </div>
            <button type="button" id="btn-admin-submit" onclick="window.EF_APP.handleAdminLogin(event)" class="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2">
              <i class="fas fa-sign-in-alt"></i>
              <span>เข้าสู่ระบบผู้ดูแลระบบ</span>
            </button>
          </form>
        </div>
      `;
      return;
    }

    const schools = window.NAN1_SCHOOLS || [];
    const totalSchools = schools.length;
    const subs = state.submissions || [];
    const uniqueSchools = new Set(subs.map(s => s.schoolId)).size;
    const groups = [...new Set(schools.map(s => s.group))].sort();

    // Dynamic calculation of district average score
    const avgDistrictScore = subs.length > 0 ? (subs.reduce((a, b) => a + (Number(b.scoreAvg) || 0), 0) / subs.length).toFixed(2) : '0.00';
    let qualityBadge = 'ยังไม่มีข้อมูลการประเมิน';
    let qualityBadgeClass = 'bg-slate-100 text-slate-600';
    if (subs.length > 0) {
      const numAvg = Number(avgDistrictScore);
      if (numAvg >= 2.5) {
        qualityBadge = 'ระดับดีมาก / เติบโตสู่ความยั่งยืน';
        qualityBadgeClass = 'bg-emerald-50 text-emerald-700';
      } else if (numAvg >= 1.8) {
        qualityBadge = 'ระดับกำลังเติบโตและปรับตัว';
        qualityBadgeClass = 'bg-blue-50 text-blue-700';
      } else {
        qualityBadge = 'จุดเริ่มต้นของการหนุนเสริม';
        qualityBadgeClass = 'bg-amber-50 text-amber-700';
      }
    }

    // Dynamic calculation of schools that completed all criteria (excluding supervisor: School + Teacher + Student + Parent >= 1)
    let completedCriteriaSchoolsCount = 0;
    schools.forEach(s => {
      const sSubs = subs.filter(sub => sub.schoolId === s.id);
      const sSch = sSubs.filter(x => x.type === 'school');
      const sTch = sSubs.filter(x => x.type === 'teacher');
      const sStu = sSubs.filter(x => x.type && x.type.startsWith('student_'));
      const sPar = sSubs.filter(x => x.type && x.type.startsWith('parent_'));
      if (sSch.length > 0 && sTch.length > 0 && sStu.length > 0 && sPar.length >= 1) {
        completedCriteriaSchoolsCount++;
      }
    });
    const completedCriteriaPct = totalSchools > 0 ? Math.round((completedCriteriaSchoolsCount / totalSchools) * 100) : 0;

    // Dynamic calculation of groups that have 100% submission rate
    const groupStatus = {};
    groups.forEach(g => {
      const groupSchools = schools.filter(s => s.group === g);
      const submittedCount = groupSchools.filter(sch => subs.some(sub => sub.schoolId === sch.id)).length;
      if (groupSchools.length > 0 && submittedCount === groupSchools.length) {
        groupStatus[g] = true;
      }
    });
    const completedGroups = Object.keys(groupStatus);
    const completedGroupsCount = completedGroups.length;
    const completedGroupsText = completedGroups.length > 0 ? completedGroups.slice(0, 3).join(', ') + (completedGroups.length > 3 ? ' และอื่นๆ' : '') : (subs.length === 0 ? 'ยังไม่มีกลุ่มที่ส่งครบ 100%' : 'กำลังรวบรวมข้อมูล');

    // 1. Сtatistics by Assessment Instrument (สถิติการตอบแบบประเมินรายชุด 5 ชุด)
    const supSubs = subs.filter(s => s.type === 'supervisor');
    const schSubs = subs.filter(s => s.type === 'school');
    const tchSubs = subs.filter(s => s.type === 'teacher');
    const stuSubs = subs.filter(s => s.type && s.type.startsWith('student_'));
    const parSubs = subs.filter(s => s.type && s.type.startsWith('parent_'));

    const calcStat = (arr) => {
      const count = arr.length;
      const avg = count > 0 ? (arr.reduce((a, b) => a + (Number(b.scoreAvg) || 0), 0) / count).toFixed(2) : '0.00';
      const numAvg = Number(avg);
      let quality = 'รอข้อมูล';
      let qColor = 'bg-slate-100 text-slate-600';
      if (count > 0) {
        if (numAvg >= 2.5) { quality = 'ระดับดีมาก / ก้าวหน้า'; qColor = 'bg-emerald-100 text-emerald-800'; }
        else if (numAvg >= 1.8) { quality = 'ระดับพอใช้ / กำลังพัฒนา'; qColor = 'bg-blue-100 text-blue-800'; }
        else { quality = 'ระดับควรหนุนเสริม'; qColor = 'bg-amber-100 text-amber-800'; }
      }
      return { count, avg, quality, qColor, numAvg };
    };

    const statSup = calcStat(supSubs);
    const statSupAttach = supSubs.filter(s => s.attachment || s.attachmentUrl).length;

    const statSch = calcStat(schSubs);
    const schDistinctSchools = new Set(schSubs.map(s => s.schoolId)).size;
    const schRate = totalSchools > 0 ? ((schDistinctSchools / totalSchools) * 100).toFixed(1) : '0.0';
    const statSchAttach = schSubs.filter(s => s.attachment || s.attachmentUrl).length;

    const statTch = calcStat(tchSubs);
    const tchEarly = tchSubs.filter(s => s.teachingStage === 'early' || (s.gradeLevel && s.gradeLevel.startsWith('a'))).length;
    const tchPrimary = tchSubs.length - tchEarly;
    const statTchAttach = tchSubs.filter(s => s.attachment || s.attachmentUrl).length;

    const statStu = calcStat(stuSubs);
    const stuEarly = stuSubs.filter(s => s.type === 'student_early').length;
    const stuPrimary = stuSubs.filter(s => s.type === 'student_primary').length;

    const statPar = calcStat(parSubs);
    const parEarly = parSubs.filter(s => s.type === 'parent_early').length;
    const parPrimary = parSubs.filter(s => s.type === 'parent_primary').length;

    // 2. Statistics by 9 EF Domains (สถิติรายด้าน 9 ด้าน)
    const domainDef = [
      { key: 'wm', code: 'WM', name: '1. ความจำที่นำมาใช้งาน (Working Memory)', shortName: 'ความจำใช้งาน', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'ic', code: 'IC', name: '2. การยั้งคิดไตร่ตรอง (Inhibitory Control)', shortName: 'ยั้งคิดไตร่ตรอง', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'sh', code: 'SH', name: '3. ความยืดหยุ่นทางความคิด (Shift)', shortName: 'ยืดหยุ่นความคิด', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'fo', code: 'FO', name: '4. การจดจ่อใส่ใจ (Focus / Attention)', shortName: 'จดจ่อใส่ใจ', group: 'กลุ่มที่ 2 : ทักษะการกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'ec', code: 'EC', name: '5. การควบคุมอารมณ์ (Emotional Control)', shortName: 'ควบคุมอารมณ์', group: 'กลุ่มที่ 2 : ทักษะการกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'sm', code: 'SM', name: '6. การติดตามประเมินตนเอง (Self-Monitoring)', shortName: 'ติดตามประเมินตน', group: 'กลุ่มที่ 2 : ทักษะการกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'in', code: 'IN', name: '7. การริเริ่มและลงมือทำ (Initiating)', shortName: 'ริเริ่มลงมือทำ', group: 'กลุ่มที่ 3 : ทักษะการลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' },
      { key: 'po', code: 'PO', name: '8. การวางแผนและการจัดระบบ (Planning)', shortName: 'วางแผนจัดระบบ', group: 'กลุ่มที่ 3 : ทักษะการลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' },
      { key: 'gp', code: 'GP', name: '9. การมุ่งเป้าหมาย (Goal-Directed)', shortName: 'มุ่งเป้าหมาย', group: 'กลุ่มที่ 3 : ทักษะการลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' }
    ];

    const adminDomainStats = domainDef.map(d => {
      let scores = [];
      if (subs.length > 0) {
        subs.forEach(s => {
          if (s.domainScores && typeof s.domainScores[d.key] === 'number') {
            scores.push(s.domainScores[d.key]);
          } else if (s.answers && typeof s.answers === 'object') {
            const matchingKeys = Object.keys(s.answers).filter(k => k.includes(`_${d.key}_`) || k.startsWith(`${d.key}_`));
            if (matchingKeys.length > 0) {
              const vals = matchingKeys.map(k => Number(s.answers[k])).filter(v => !isNaN(v));
              if (vals.length > 0) {
                scores.push(vals.reduce((a, b) => a + b, 0) / vals.length);
              }
            } else if (typeof s.scoreAvg === 'number' && s.scoreAvg > 0) {
              scores.push(s.scoreAvg);
            }
          } else if (typeof s.scoreAvg === 'number' && s.scoreAvg > 0) {
            scores.push(s.scoreAvg);
          }
        });
      }

      const count = scores.length;
      const avg = count > 0 ? scores.reduce((a, b) => a + b, 0) / count : 0;
      let sd = 0;
      if (count > 1) {
        const variance = scores.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / (count - 1);
        sd = Math.sqrt(variance);
      }
      const pct = (avg / 3.0) * 100;
      let quality = count > 0 ? (avg >= 2.5 ? 'ระดับดีมาก' : avg >= 1.8 ? 'ระดับพอใช้' : 'ควรหนุนเสริม') : 'รอข้อมูล';
      let qColor = count > 0 ? (avg >= 2.5 ? 'bg-emerald-100 text-emerald-800' : avg >= 1.8 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800') : 'bg-slate-100 text-slate-600';
      let barColor = avg >= 2.5 ? 'bg-emerald-500' : avg >= 1.8 ? 'bg-blue-600' : 'bg-amber-500';

      return {
        ...d,
        count,
        avg: avg.toFixed(2),
        sd: sd.toFixed(2),
        pct: pct.toFixed(1) + '%',
        pctNum: pct,
        quality,
        qColor,
        barColor,
        numAvg: avg
      };
    });

    const basicDomains = adminDomainStats.filter(d => d.groupKey === 'basic');
    const basicScore = (basicDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2);

    const selfDomains = adminDomainStats.filter(d => d.groupKey === 'self');
    const selfScore = (selfDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2);

    const practiceDomains = adminDomainStats.filter(d => d.groupKey === 'practice');
    const practiceScore = (practiceDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2);

    container.innerHTML = `
      <div class="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800">ผู้ดูแลระบบ (Admin)</span>
            <span class="text-xs text-slate-400">สพป.น่าน เขต 1</span>
          </div>
          <h2 class="text-2xl md:text-3xl font-bold text-slate-800">แผงควบคุมสารสนเทศและติดตามภาพรวมเขตพื้นที่</h2>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <button onclick="document.getElementById('admin-media-gallery-section') ? document.getElementById('admin-media-gallery-section').scrollIntoView({behavior: 'smooth'}) : null" class="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition" title="ไปยังคลังรูปภาพและไฟล์แนบร่องรอย">
            <i class="fas fa-photo-video"></i>
            <span>คลังภาพ & ไฟล์แนบ</span>
          </button>
          <button onclick="window.EF_APP.syncWithGoogleSheet()" class="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition">
            <i class="fas fa-sync-alt"></i>
            <span>ซิงค์ข้อมูลจาก Google Sheet</span>
          </button>
          <button onclick="window.EF_APP.clearDemoSubmissions()" class="px-3.5 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center gap-1.5 shadow-sm transition" title="ล้างข้อมูลทั้งหมดในระบบเพื่อเริ่มนับจาก 0">
            <i class="fas fa-trash-alt"></i>
            <span>ล้างข้อมูลระบบ (นับ 0 จริง)</span>
          </button>
          <button onclick="window.EF_APP.openExportProgressModal()" class="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition" title="ส่งออกข้อมูลสารสนเทศเป็นไฟล์ CSV หรือ Excel แบบเลือกประเภทได้">
            <i class="fas fa-file-csv"></i>
            <span>Export ข้อมูล (CSV / Excel)</span>
          </button>
          <button onclick="window.EF_APP.openChangePasswordModal()" class="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition" title="เปลี่ยนรหัสผ่าน Admin">
            <i class="fas fa-key text-amber-400"></i>
            <span>เปลี่ยนรหัสผ่าน</span>
          </button>
          <button onclick="window.EF_APP.openSettingsModal()" class="px-3 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition" title="ตั้งค่า Web App">
            <i class="fas fa-cog text-slate-500"></i>
          </button>
          <button onclick="window.EF_APP.adminLogout()" class="px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 text-xs font-medium transition" title="ออกจากระบบ">
            <i class="fas fa-sign-out-alt"></i>
          </button>
        </div>
      </div>

      <!-- District Executive KPIs (5 Cards Grid) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-5 mb-8">
        <!-- Card 1: เริ่มส่งข้อมูลแล้ว -->
        <div class="academic-card p-5 bg-gradient-to-br from-blue-900 to-indigo-950 text-white border-none shadow-xl flex flex-col justify-between">
          <div>
            <span class="text-xs font-semibold text-blue-200 uppercase tracking-wider">ความก้าวหน้าทั้งเขตพื้นที่</span>
            <div class="text-3xl font-bold text-white mt-2 mb-1">${uniqueSchools} / ${totalSchools} <span class="text-sm font-normal text-slate-300">แห่ง</span></div>
            <div class="w-full bg-blue-950/80 rounded-full h-2 mt-3 overflow-hidden">
              <div class="bg-amber-400 h-2 rounded-full" style="width: ${totalSchools > 0 ? Math.round((uniqueSchools/totalSchools)*100) : 0}%"></div>
            </div>
          </div>
          <p class="text-[11px] text-blue-200 mt-2">${totalSchools > 0 ? Math.round((uniqueSchools/totalSchools)*100) : 0}% ของโรงเรียนทั้งหมดส่งข้อมูลแล้ว</p>
        </div>

        <!-- Card 2: โรงเรียนที่ส่งครบตามเงื่อนไข (ยกเว้น ศน.) -->
        <div class="academic-card p-5 border-l-4 border-l-emerald-600 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-500">ส่งครบตามเกณฑ์</span>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                ยกเว้น ศน.
              </span>
            </div>
            <div class="text-3xl font-bold text-emerald-700 mt-2 mb-1">${completedCriteriaSchoolsCount} / ${totalSchools} <span class="text-sm font-normal text-slate-500">แห่ง</span></div>
            <div class="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
              <div class="bg-emerald-500 h-2 rounded-full" style="width: ${completedCriteriaPct}%"></div>
            </div>
          </div>
          <p class="text-[11px] text-slate-500 mt-2">ครบ 4 ชุดหลัก (${completedCriteriaPct}% ของเขต)</p>
        </div>

        <!-- Card 3: จำนวนชุดข้อมูลประเมินทั้งหมด -->
        <div class="academic-card p-5 border-l-4 border-l-sky-500 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <span class="text-xs font-semibold text-slate-500">จำนวนชุดข้อมูลทั้งหมด</span>
            <div class="text-3xl font-bold text-slate-800 mt-2 mb-1">${subs.length} <span class="text-sm font-normal text-slate-500">ชุด</span></div>
          </div>
          <p class="text-[11px] text-slate-500 mt-2">ประเมินครู, นร., ผปค., รร., ศน.</p>
        </div>

        <!-- Card 4: คะแนนเฉลี่ย EF ภาพรวมเขต -->
        <div class="academic-card p-5 border-l-4 border-l-teal-500 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <span class="text-xs font-semibold text-slate-500">คะแนนเฉลี่ย EF ภาพรวมเขต</span>
            <div class="text-3xl font-bold text-teal-700 mt-2 mb-1">${avgDistrictScore} <span class="text-sm font-normal text-slate-500">/ 3.00</span></div>
          </div>
          <span class="inline-block text-[11px] font-semibold ${qualityBadgeClass} px-2 py-0.5 rounded mt-2 w-fit">
            ${qualityBadge}
          </span>
        </div>

        <!-- Card 5: กลุ่มโรงเรียนที่ส่งครบ 100% -->
        <div class="academic-card p-5 border-l-4 border-l-amber-500 bg-white border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <span class="text-xs font-semibold text-slate-500">กลุ่มโรงเรียนส่งครบ 100%</span>
            <div class="text-3xl font-bold text-amber-700 mt-2 mb-1">${completedGroupsCount} <span class="text-sm font-normal text-slate-500">กลุ่ม</span></div>
          </div>
          <p class="text-[11px] text-slate-500 mt-2 truncate" title="${completedGroupsText}">${completedGroupsText}</p>
        </div>
      </div>

      <!-- 1. สถิติการตอบแบบประเมินจำแนกรายชุด (5 ชุดเครื่องมือมาตรฐาน) -->
      <div class="academic-card p-6 md:p-8 mb-10 bg-white border border-slate-200 shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2 mb-6">
          <div>
            <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
              <i class="fas fa-layer-group text-blue-600"></i>
              <span>สถิติการตอบแบบประเมินจำแนกรายชุด (5 ชุดเครื่องมือมาตรฐาน)</span>
            </h3>
            <p class="text-xs text-slate-500">สรุปจำนวนการตอบแบบประเมิน ค่าเฉลี่ยคะแนน และระดับคุณภาพแยกตามบทบาทผู้ประเมิน</p>
          </div>
          <span class="text-xs px-3 py-1 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-200 w-fit">
            รวมบันทึกทั้งหมด ${subs.length} ชุด
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <!-- ชุดที่ 1 : ศึกษานิเทศก์ -->
          <div class="p-5 bg-gradient-to-br from-slate-50 to-blue-50/40 border border-slate-200 rounded-2xl flex flex-col justify-between hover:border-blue-300 transition">
            <div>
              <div class="flex items-center justify-between mb-3">
                <span class="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-base shadow-sm">
                  <i class="fas fa-user-tie"></i>
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  ชุดที่ 1
                </span>
              </div>
              <h4 class="text-sm font-bold text-slate-800 leading-tight">ศึกษานิเทศก์</h4>
              <p class="text-[11px] text-slate-500 mt-1">นิเทศ โค้ช และติดตาม</p>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-200/60 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">ส่งแล้ว</span>
                <strong class="text-slate-800 text-sm font-bold">${statSup.count} <span class="text-[11px] font-normal text-slate-500">ชุด</span></strong>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">คะแนนเฉลี่ย</span>
                <strong class="text-blue-700 text-sm font-bold">${statSup.avg} <span class="text-[10px] font-normal text-slate-400">/ 3.00</span></strong>
              </div>
              <div class="pt-1">
                <span class="inline-block w-full text-center text-[10px] font-semibold ${statSup.qColor} px-2 py-1 rounded-lg">
                  ${statSup.quality}
                </span>
              </div>
              ${statSupAttach > 0 ? `
                <div class="text-[10px] text-blue-600 font-medium flex items-center gap-1 justify-center pt-1">
                  <i class="fas fa-paperclip"></i> แนบไฟล์ ${statSupAttach} ชุด
                </div>
              ` : ''}
            </div>
          </div>

          <!-- ชุดที่ 2 : สถานศึกษา -->
          <div class="p-5 bg-gradient-to-br from-slate-50 to-amber-50/40 border border-slate-200 rounded-2xl flex flex-col justify-between hover:border-amber-300 transition">
            <div>
              <div class="flex items-center justify-between mb-3">
                <span class="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-base shadow-sm">
                  <i class="fas fa-school"></i>
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  ชุดที่ 2
                </span>
              </div>
              <h4 class="text-sm font-bold text-slate-800 leading-tight">สถานศึกษา</h4>
              <p class="text-[11px] text-slate-500 mt-1">ประเมินตนเองระดับโรงเรียน</p>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-200/60 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">ส่งแล้ว</span>
                <strong class="text-slate-800 text-sm font-bold">${schDistinctSchools} <span class="text-[11px] font-normal text-slate-500">/ ${totalSchools} แห่ง (${schRate}%)</span></strong>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">คะแนนเฉลี่ย</span>
                <strong class="text-amber-700 text-sm font-bold">${statSch.avg} <span class="text-[10px] font-normal text-slate-400">/ 3.00</span></strong>
              </div>
              <div class="pt-1">
                <span class="inline-block w-full text-center text-[10px] font-semibold ${statSch.qColor} px-2 py-1 rounded-lg">
                  ${statSch.quality}
                </span>
              </div>
              ${statSchAttach > 0 ? `
                <div class="text-[10px] text-amber-700 font-medium flex items-center gap-1 justify-center pt-1">
                  <i class="fas fa-paperclip"></i> แนบไฟล์ ${statSchAttach} ชุด
                </div>
              ` : ''}
            </div>
          </div>

          <!-- ชุดที่ 3 : ครูผู้สอน -->
          <div class="p-5 bg-gradient-to-br from-slate-50 to-emerald-50/40 border border-slate-200 rounded-2xl flex flex-col justify-between hover:border-emerald-300 transition">
            <div>
              <div class="flex items-center justify-between mb-3">
                <span class="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-base shadow-sm">
                  <i class="fas fa-chalkboard-teacher"></i>
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  ชุดที่ 3
                </span>
              </div>
              <h4 class="text-sm font-bold text-slate-800 leading-tight">ครูผู้สอน</h4>
              <p class="text-[11px] text-slate-500 mt-1">ปฐมวัย & สุขศึกษา/พลฯ ป.1-3</p>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-200/60 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">ส่งแล้ว</span>
                <strong class="text-slate-800 text-sm font-bold">${statTch.count} <span class="text-[11px] font-normal text-slate-500">คน</span></strong>
              </div>
              <div class="flex items-center justify-between text-[10px] text-slate-500 bg-white/70 p-1.5 rounded-lg border border-slate-200">
                <span>ปฐมวัย: <strong class="text-slate-800">${tchEarly}</strong></span>
                <span>สุขศึกษา/พลฯ: <strong class="text-slate-800">${tchPrimary}</strong></span>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">คะแนนเฉลี่ย</span>
                <strong class="text-emerald-700 text-sm font-bold">${statTch.avg} <span class="text-[10px] font-normal text-slate-400">/ 3.00</span></strong>
              </div>
              <div class="pt-1">
                <span class="inline-block w-full text-center text-[10px] font-semibold ${statTch.qColor} px-2 py-1 rounded-lg">
                  ${statTch.quality}
                </span>
              </div>
              ${statTchAttach > 0 ? `
                <div class="text-[10px] text-emerald-700 font-medium flex items-center gap-1 justify-center pt-1">
                  <i class="fas fa-paperclip"></i> แนบไฟล์ ${statTchAttach} ชุด
                </div>
              ` : ''}
            </div>
          </div>

          <!-- ชุดที่ 4 : เด็ก/นักเรียน -->
          <div class="p-5 bg-gradient-to-br from-slate-50 to-sky-50/40 border border-slate-200 rounded-2xl flex flex-col justify-between hover:border-sky-300 transition">
            <div>
              <div class="flex items-center justify-between mb-3">
                <span class="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center text-base shadow-sm">
                  <i class="fas fa-child"></i>
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">
                  ชุดที่ 4
                </span>
              </div>
              <h4 class="text-sm font-bold text-slate-800 leading-tight">เด็กและนักเรียน</h4>
              <p class="text-[11px] text-slate-500 mt-1">สมรรถนะทักษะสมอง EF 9 ด้าน</p>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-200/60 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">ประเมินแล้ว</span>
                <strong class="text-slate-800 text-sm font-bold">${statStu.count} <span class="text-[11px] font-normal text-slate-500">คน</span></strong>
              </div>
              <div class="flex items-center justify-between text-[10px] text-slate-500 bg-white/70 p-1.5 rounded-lg border border-slate-200">
                <span>ปฐมวัย: <strong class="text-slate-800">${stuEarly}</strong></span>
                <span>ประถม: <strong class="text-slate-800">${stuPrimary}</strong></span>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">คะแนนเฉลี่ย</span>
                <strong class="text-sky-700 text-sm font-bold">${statStu.avg} <span class="text-[10px] font-normal text-slate-400">/ 3.00</span></strong>
              </div>
              <div class="pt-1">
                <span class="inline-block w-full text-center text-[10px] font-semibold ${statStu.qColor} px-2 py-1 rounded-lg">
                  ${statStu.quality}
                </span>
              </div>
            </div>
          </div>

          <!-- ชุดที่ 5 : ผู้ปกครอง -->
          <div class="p-5 bg-gradient-to-br from-slate-50 to-rose-50/40 border border-slate-200 rounded-2xl flex flex-col justify-between hover:border-rose-300 transition">
            <div>
              <div class="flex items-center justify-between mb-3">
                <span class="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-base shadow-sm">
                  <i class="fas fa-heart"></i>
                </span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                  ชุดที่ 5
                </span>
              </div>
              <h4 class="text-sm font-bold text-slate-800 leading-tight">ผู้ปกครอง</h4>
              <p class="text-[11px] text-slate-500 mt-1">ส่งเสริมและสังเกตเด็กที่บ้าน</p>
            </div>

            <div class="mt-4 pt-3 border-t border-slate-200/60 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">ตอบแล้ว</span>
                <strong class="text-slate-800 text-sm font-bold">${statPar.count} <span class="text-[11px] font-normal text-slate-500">คน</span></strong>
              </div>
              <div class="flex items-center justify-between text-[10px] text-slate-500 bg-white/70 p-1.5 rounded-lg border border-slate-200">
                <span>ปฐมวัย: <strong class="text-slate-800">${parEarly}</strong></span>
                <span>ประถม: <strong class="text-slate-800">${parPrimary}</strong></span>
              </div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-500">คะแนนเฉลี่ย</span>
                <strong class="text-rose-700 text-sm font-bold">${statPar.avg} <span class="text-[10px] font-normal text-slate-400">/ 3.00</span></strong>
              </div>
              <div class="pt-1">
                <span class="inline-block w-full text-center text-[10px] font-semibold ${statPar.qColor} px-2 py-1 rounded-lg">
                  ${statPar.quality}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. สถิติสมรรถนะทักษะสมอง EF จำแนกรายด้าน (9 ด้านมาตรฐาน) -->
      <div class="academic-card p-6 md:p-8 mb-10 bg-white border border-slate-200 shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3 mb-6">
          <div>
            <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
              <i class="fas fa-brain text-indigo-600"></i>
              <span>สถิติสมรรถนะทักษะสมอง EF จำแนกรายด้าน (9 ด้านมาตรฐาน)</span>
            </h3>
            <p class="text-xs text-slate-500">วิเคราะห์ค่าเฉลี่ย (x̄), ส่วนเบี่ยงเบนมาตรฐาน (S.D.) และระดับคุณภาพรายสมรรถนะทักษะสมอง</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="px-3 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-200">
              เกณฑ์คะแนนเต็ม 3.00
            </span>
          </div>
        </div>

        <!-- 3 Pillar Summary Cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="p-4 rounded-xl bg-gradient-to-br from-blue-50/80 to-sky-50/80 border border-blue-200">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-blue-900">กลุ่มที่ 1 : ทักษะพื้นฐาน</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-200 text-blue-800 font-bold">Basic Skills</span>
            </div>
            <div class="text-2xl font-bold text-blue-700 mt-2">${basicScore} <span class="text-xs font-normal text-slate-500">/ 3.00</span></div>
            <p class="text-[11px] text-slate-600 mt-1">1. ความจำใช้งาน • 2. ยั้งคิดไตร่ตรอง • 3. ยืดหยุ่นความคิด</p>
          </div>

          <div class="p-4 rounded-xl bg-gradient-to-br from-indigo-50/80 to-purple-50/80 border border-indigo-200">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-indigo-900">กลุ่มที่ 2 : ทักษะกำกับตนเอง</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-800 font-bold">Self-Regulation</span>
            </div>
            <div class="text-2xl font-bold text-indigo-700 mt-2">${selfScore} <span class="text-xs font-normal text-slate-500">/ 3.00</span></div>
            <p class="text-[11px] text-slate-600 mt-1">4. จดจ่อใส่ใจ • 5. ควบคุมอารมณ์ • 6. ติดตามประเมินตน</p>
          </div>

          <div class="p-4 rounded-xl bg-gradient-to-br from-emerald-50/80 to-teal-50/80 border border-emerald-200">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-bold text-emerald-900">กลุ่มที่ 3 : ทักษะลงมือปฏิบัติ</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-bold">Practice Skills</span>
            </div>
            <div class="text-2xl font-bold text-emerald-700 mt-2">${practiceScore} <span class="text-xs font-normal text-slate-500">/ 3.00</span></div>
            <p class="text-[11px] text-slate-600 mt-1">7. ริเริ่มลงมือทำ • 8. วางแผนจัดระบบ • 9. มุ่งเป้าหมาย</p>
          </div>
        </div>

        <!-- 9 Domains Detailed Table -->
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th class="p-3 w-12 text-center">ลำดับ</th>
                <th class="p-3">ด้านทักษะสมอง (EF Domain)</th>
                <th class="p-3">กลุ่มทักษะ</th>
                <th class="p-3 text-center w-24">ประเมิน (ชุด)</th>
                <th class="p-3 text-center w-28">ค่าเฉลี่ย (x̄)</th>
                <th class="p-3 text-center w-20">S.D.</th>
                <th class="p-3 w-40">ระดับการเติบโต (%)</th>
                <th class="p-3 text-center w-36">ระดับคุณภาพ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${adminDomainStats.map((d, idx) => `
                <tr class="hover:bg-slate-50/80 transition">
                  <td class="p-3 text-center font-bold text-slate-500">${idx + 1}</td>
                  <td class="p-3">
                    <strong class="text-slate-800 block">${d.name}</strong>
                  </td>
                  <td class="p-3 text-[11px] text-slate-500">
                    <span class="px-2 py-0.5 rounded-full ${
                      d.groupKey === 'basic' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                      d.groupKey === 'self' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                      'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }">${d.group.split(':')[1] ? d.group.split(':')[1].trim() : d.group}</span>
                  </td>
                  <td class="p-3 text-center font-semibold text-slate-700">${d.count}</td>
                  <td class="p-3 text-center">
                    <strong class="text-sm ${d.numAvg >= 2.5 ? 'text-emerald-700' : d.numAvg >= 1.8 ? 'text-blue-700' : 'text-amber-700'}">${d.avg}</strong>
                    <span class="text-[10px] text-slate-400 block">/ 3.00</span>
                  </td>
                  <td class="p-3 text-center text-slate-500 font-mono">${d.sd}</td>
                  <td class="p-3">
                    <div class="flex items-center gap-2">
                      <div class="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div class="${d.barColor} h-2 rounded-full" style="width: ${d.pctNum}%"></div>
                      </div>
                      <span class="text-[11px] font-mono text-slate-600 shrink-0">${d.pct}</span>
                    </div>
                  </td>
                  <td class="p-3 text-center">
                    <span class="inline-block px-2.5 py-1 rounded-full text-[10px] font-semibold ${d.qColor}">
                      ${d.quality}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- OBEC Quick Dispatch Box in Admin -->
      <div class="p-6 rounded-2xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400 text-slate-950 font-bold text-xs mb-2">
            <i class="fas fa-file-signature"></i> OBEC Form Assistant
          </div>
          <h3 class="text-xl font-bold">ศูนย์เตรียมข้อมูลรายงาน สพฐ. (ระดับปฐมวัย & ประถมศึกษา ป.1-3)</h3>
          <p class="text-xs text-blue-200 mt-1">ประมวลผลข้อมูล 145 โรงเรียน เพื่อนำไปกรอกลง Google Form ของ สพฐ. พร้อมปุ่มคัดลอก (Copy) และออกรายงาน PDF แนบส่ง</p>
        </div>
        <button onclick="window.EF_APP.switchReportTab('obec'); window.EF_APP.navigate('academic-report');" class="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg transition whitespace-nowrap">
          <span>เข้าสู่ระบบเตรียมข้อมูลรายงาน สพฐ.</span>
          <i class="fas fa-arrow-right"></i>
        </button>
      </div>

      <!-- Analytics Charts Section -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
        <!-- Radar Chart: EF 9 Domains District Profile -->
        <div class="academic-card p-6 bg-white border border-slate-200">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="text-base font-bold text-slate-800">สมรรถนะทักษะสมอง EF 9 ด้าน (ภาพรวมเขตพื้นที่)</h3>
              <p class="text-xs text-slate-500">เปรียบเทียบระดับการพัฒนาทักษะสมอง Executive Functions</p>
            </div>
            <span class="academic-badge text-[11px]">Radar Profile</span>
          </div>
          <div class="chart-container h-80 flex items-center justify-center">
            <canvas id="admin-ef-radar-chart"></canvas>
          </div>
        </div>

        <!-- Bar Chart: Group Performance Comparison -->
        <div class="academic-card p-6 bg-white border border-slate-200">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="text-base font-bold text-slate-800">คะแนนเฉลี่ยจำแนกรายกลุ่มโรงเรียน (16 กลุ่ม)</h3>
              <p class="text-xs text-slate-500">ผลการประเมินการขับเคลื่อน EF รายกลุ่มเครือข่าย</p>
            </div>
            <span class="academic-badge text-[11px]">Group Comparison</span>
          </div>
          <div class="chart-container h-80 flex items-center justify-center">
            <canvas id="admin-group-bar-chart"></canvas>
          </div>
        </div>
      </div>

      <!-- School Tracking Matrix Table -->
      <!-- School Tracking Matrix Table -->
      <div class="academic-card p-6 mb-10 bg-white border border-slate-200 shadow-sm">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
              <i class="fas fa-tasks text-blue-600"></i>
              <span>ตารางกำกับ ติดตาม ความคืบหน้ารายสถานศึกษา (145 แห่ง)</span>
            </h3>
            <p class="text-xs text-slate-500">ตรวจสอบสถานะการตอบแบบประเมินรายชุด (5 ชุด) และสมรรถนะ EF รายด้าน (9 ด้าน) รายโรงเรียน</p>
          </div>

          <div class="flex flex-wrap items-center gap-2.5">
            <input type="text" id="admin-table-search" placeholder="ค้นหาชื่อ/รหัสโรงเรียน..." class="bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none w-44">
            <select id="admin-table-group-filter" class="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none">
              <option value="all">ทุกกลุ่มโรงเรียน (16 กลุ่ม)</option>
              ${groups.map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>
            <select id="admin-table-status-filter" class="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none">
              <option value="all">ทุกสถานะความคืบหน้า</option>
              <option value="completed">✓ ครบเกณฑ์สถานศึกษา (รร.+ครู+นร.+ผปค. ≥1)</option>
              <option value="partial">⏳ กำลังดำเนินการ (1-3 ชุด)</option>
              <option value="none">⭕ ยังไม่เริ่มส่ง (0 ชุด)</option>
              <option value="has_sup">มีบันทึกศึกษานิเทศก์ (ศน.)</option>
              <option value="has_sch">มีบันทึกสถานศึกษา (รร.)</option>
              <option value="has_tch">มีบันทึกครูผู้สอน</option>
              <option value="has_stu">มีบันทึกนักเรียน</option>
              <option value="has_par">มีบันทึกผู้ปกครอง (≥ 1 คน)</option>
              <option value="missing_sch">ขาดชุดสถานศึกษา</option>
              <option value="missing_tch">ขาดชุดครูผู้สอน</option>
              <option value="missing_stu">ขาดชุดนักเรียน</option>
              <option value="missing_par">ขาดชุดผู้ปกครอง (&lt; 1 คน)</option>
            </select>
            <button onclick="window.EF_APP.openExportProgressModal()" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition active:scale-95" title="ส่งออกตารางติดตามความคืบหน้าเป็นไฟล์ CSV หรือ Excel">
              <i class="fas fa-file-csv text-sm"></i>
              <span>Export CSV / Excel</span>
            </button>
          </div>
        </div>

        <!-- Table Container -->
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th class="p-3 w-16 text-center">รหัส</th>
                <th class="p-3">ชื่อสถานศึกษา</th>
                <th class="p-3">กลุ่ม / อำเภอ</th>
                <th class="p-3 text-center">ขนาด (นร.)</th>
                <th class="p-3 text-center">ความคืบหน้า 5 ชุด (ศน.|รร.|ครู|นร.|ผปค.)</th>
                <th class="p-3 text-center w-20">ส่งรวม</th>
                <th class="p-3 text-center w-20">เฉลี่ย (x̄)</th>
                <th class="p-3 text-center w-28">สถานะรวม</th>
                <th class="p-3 text-center w-36">การตรวจสอบ</th>
              </tr>
            </thead>
            <tbody id="admin-school-table-body" class="divide-y divide-slate-100">
              <!-- Rendered dynamically -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- 5. Media & Evidence Gallery Hub (คลังสื่อ ภาพถ่าย และเอกสารร่องรอยการประเมินเพื่อการจัดทำรายงาน) -->
      <div id="admin-media-gallery-section" class="academic-card p-6 mb-10 bg-white border border-slate-200 shadow-sm scroll-mt-24">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2 mb-6">
          <div>
            <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
              <i class="fas fa-photo-video text-indigo-600"></i>
              <span>คลังสื่อ ภาพถ่าย และไฟล์เอกสารร่องรอยการประเมิน (Media & Evidence Gallery Hub)</span>
            </h3>
            <p class="text-xs text-slate-500">เรียกดู ค้นหา พรีวิว คัดลอกลิงก์ และส่งออกภาพถ่าย/ไฟล์เอกสารสำหรับนำไปจัดทำเล่มรายงานทางการและ SAR</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">
              สำหรับจัดทำรายงาน & SAR
            </span>
          </div>
        </div>

        <div id="admin-media-gallery-container">
          <!-- Rendered dynamically by renderAdminMediaGallery() -->
        </div>
      </div>

      <!-- 6. Raw Submissions Data Table -->
      <div class="academic-card p-6 bg-white border border-slate-200">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-lg font-bold text-slate-800">ฐานข้อมูลรายการตอบแบบประเมินทั้งหมด (Raw Submissions)</h3>
            <p class="text-xs text-slate-500">บันทึกล่าสุด ${subs.length} รายการ</p>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th class="p-3">รหัสส่ง</th>
                <th class="p-3">ประเภทแบบประเมิน</th>
                <th class="p-3">โรงเรียน</th>
                <th class="p-3">กลุ่ม</th>
                <th class="p-3">ผู้ประเมิน / นักเรียน</th>
                <th class="p-3 text-center">คะแนนเฉลี่ย</th>
                <th class="p-3 text-center">ระดับคุณภาพ</th>
                <th class="p-3 text-center">วันที่</th>
                <th class="p-3 text-center">ตรวจสอบ / จัดการ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${subs.length > 0 ? subs.slice(0, 50).map(s => `
                <tr class="hover:bg-slate-50">
                  <td class="p-3 font-mono text-slate-500">${s.id}</td>
                  <td class="p-3 font-medium text-slate-800">
                    ${s.typeName}
                    ${s.attachment ? `<span class="inline-flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold ml-1 cursor-pointer hover:bg-blue-200 transition" onclick="window.EF_APP.openMediaLightbox('${s.id}')" title="${s.attachment.name}"><i class="fas fa-paperclip"></i> มีไฟล์แนบ</span>` : ''}
                  </td>
                  <td class="p-3 text-slate-700">${s.schoolName}</td>
                  <td class="p-3 text-slate-500">${s.schoolGroup}</td>
                  <td class="p-3 text-slate-700">${s.studentName ? s.studentName + ' (' + s.evaluator + ')' : s.evaluator}</td>
                  <td class="p-3 text-center font-bold text-blue-700">${(Number(s.scoreAvg) || 0).toFixed(2)}</td>
                  <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${
                      s.scoreAvg >= 2.5 ? 'bg-emerald-100 text-emerald-800' : s.scoreAvg >= 1.8 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                    }">${s.qualityLevel}</span>
                  </td>
                  <td class="p-3 text-center text-slate-500 font-mono text-xs">${formatThaiDate(s.date)}</td>
                  <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                      <button onclick="window.EF_APP.viewSubmissionDetail('${s.id}')" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] flex items-center gap-1 transition" title="ตรวจสอบคำตอบย้อนหลัง">
                        <i class="fas fa-search-plus"></i>
                        <span>ตรวจสอบ</span>
                      </button>
                      <button onclick="window.EF_APP.deleteSubmission('${s.id}')" class="p-1 rounded text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition" title="ลบรายการนี้">
                        <i class="fas fa-trash-alt"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="9" class="p-6 text-center text-slate-400">ยังไม่มีข้อมูลการประเมินในระบบ</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    `;

    renderAdminCharts();
    renderAdminSchoolTable();
    renderAdminMediaGallery();

    // Hook search & filter
    const searchInp = document.getElementById('admin-table-search');
    const grpSel = document.getElementById('admin-table-group-filter');
    const statusSel = document.getElementById('admin-table-status-filter');
    if (searchInp && grpSel) {
      searchInp.addEventListener('input', renderAdminSchoolTable);
      grpSel.addEventListener('change', renderAdminSchoolTable);
      if (statusSel) statusSel.addEventListener('change', renderAdminSchoolTable);
    }
  }

  function handleAdminLogin(e) {
    if (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    }
    const input = document.getElementById('admin-passcode-input');
    const val = (input ? input.value : '').trim();
    const currentPass = getAdminPasscode();
    
    if (val && (val === currentPass || val.toLowerCase() === currentPass.toLowerCase() || (currentPass === DEFAULT_ADMIN_PASSCODE && (val.toLowerCase() === 'admin' || val.toLowerCase() === 'nan1ef')))) {
      state.adminAuth = true;
      sessionStorage.setItem('ef69_admin_auth', 'true');
      localStorage.setItem('ef69_admin_auth', 'true');
      showToast('เข้าสู่ระบบผู้ดูแลระบบสำเร็จ', 'success');
      if (state.currentRoute === 'academic-report') {
        renderAcademicReportView();
      } else {
        renderAdminView();
      }
    } else {
      showToast('รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง', 'error');
    }
    return false;
  }

  function adminLogout() {
    state.adminAuth = false;
    sessionStorage.removeItem('ef69_admin_auth');
    localStorage.removeItem('ef69_admin_auth');
    showToast('ออกจากระบบผู้ดูแลระบบเรียบร้อยแล้ว', 'info');
    if (state.currentRoute === 'academic-report') {
      state.reportTab = 'academic';
      renderAcademicReportView();
    } else {
      renderAdminView();
    }
  }

  function openChangePasswordModal() {
    const existing = document.getElementById('change-password-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'change-password-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-fade-in';
    modal.innerHTML = `
      <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
        <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-bold">
              <i class="fas fa-key"></i>
            </div>
            <h3 class="text-base font-bold text-slate-800">เปลี่ยนรหัสผ่านผู้ดูแลระบบ (Admin)</h3>
          </div>
          <button onclick="document.getElementById('change-password-modal').remove()" class="text-slate-400 hover:text-slate-600 text-lg">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <form id="change-pass-form" onsubmit="event.preventDefault(); window.EF_APP.saveNewAdminPassword();" class="space-y-4 text-left">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1.5">รหัสผ่านปัจจุบัน <span class="text-rose-500">*</span></label>
            <input type="password" id="current-pass-input" required placeholder="ระบุรหัสผ่านปัจจุบัน"
              class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1.5">รหัสผ่านใหม่ <span class="text-rose-500">*</span></label>
            <input type="password" id="new-pass-input" required placeholder="ระบุรหัสผ่านใหม่ (อย่างน้อย 4 ตัวอักษร)"
              class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1.5">ยืนยันรหัสผ่านใหม่ <span class="text-rose-500">*</span></label>
            <input type="password" id="confirm-pass-input" required placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
              class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button type="button" onclick="document.getElementById('change-password-modal').remove()" class="px-4 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-700">ยกเลิก</button>
            <button type="submit" class="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md flex items-center gap-1.5">
              <i class="fas fa-save"></i>
              <span>บันทึกรหัสผ่านใหม่</span>
            </button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function saveNewAdminPassword() {
    const cur = (document.getElementById('current-pass-input') || {}).value || '';
    const nPass = (document.getElementById('new-pass-input') || {}).value || '';
    const cPass = (document.getElementById('confirm-pass-input') || {}).value || '';

    const currentActual = getAdminPasscode();
    const isCurrentValid = cur === currentActual || cur.toLowerCase() === currentActual.toLowerCase() || (currentActual === DEFAULT_ADMIN_PASSCODE && (cur.toLowerCase() === 'admin' || cur.toLowerCase() === 'nan1ef'));

    if (!isCurrentValid) {
      showToast('รหัสผ่านปัจจุบันไม่ถูกต้อง', 'error');
      return;
    }

    if (!nPass || nPass.length < 4) {
      showToast('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร', 'error');
      return;
    }

    if (nPass !== cPass) {
      showToast('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน', 'error');
      return;
    }

    setAdminPasscode(nPass);
    showToast('เปลี่ยนรหัสผ่านผู้ดูแลระบบสำเร็จเรียบร้อยแล้ว!', 'success');
    const modal = document.getElementById('change-password-modal');
    if (modal) modal.remove();
  }

  function renderAdminCharts() {
    if (!window.Chart) return;

    const subs = state.submissions || [];

    // 1. Radar Chart: 9 EF dimensions
    const radarCanvas = document.getElementById('admin-ef-radar-chart');
    if (radarCanvas) {
      if (window.adminRadarChartInstance) {
        window.adminRadarChartInstance.destroy();
      }

      let radarData = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      if (subs.length > 0) {
        const studentSubs = subs.filter(s => s.domainScores);
        if (studentSubs.length > 0) {
          const domainKeys = ['wm', 'ic', 'sh', 'fo', 'ec', 'sm', 'in', 'po', 'gp'];
          radarData = domainKeys.map(k => {
            const valid = studentSubs.filter(s => s.domainScores && typeof s.domainScores[k] === 'number');
            if (valid.length > 0) {
              return Number((valid.reduce((acc, curr) => acc + curr.domainScores[k], 0) / valid.length).toFixed(2));
            }
            return Number((subs.reduce((acc, curr) => acc + curr.scoreAvg, 0) / subs.length).toFixed(2));
          });
        } else {
          const overall = Number((subs.reduce((acc, curr) => acc + curr.scoreAvg, 0) / subs.length).toFixed(2));
          radarData = [overall, overall, overall, overall, overall, overall, overall, overall, overall];
        }
      }

      window.adminRadarChartInstance = new Chart(radarCanvas, {
        type: 'radar',
        data: {
          labels: [
            '1. ความจำใช้งาน (WM)',
            '2. ยั้งคิดไตร่ตรอง (Inhibitory)',
            '3. ยืดหยุ่นความคิด (Shift)',
            '4. จดจ่อใส่ใจ (Focus)',
            '5. คุมอารมณ์ (Emotion)',
            '6. ติดตามประเมินตน (Monitoring)',
            '7. ริเริ่มลงมือทำ (Initiating)',
            '8. วางแผนจัดระบบ (Planning)',
            '9. มุ่งเป้าหมาย (Goal)'
          ],
          datasets: [
            {
              label: 'คะแนนเฉลี่ย สพป.น่าน 1 (ปี 2569)',
              data: radarData,
              backgroundColor: 'rgba(37, 99, 235, 0.2)',
              borderColor: 'rgba(37, 99, 235, 1)',
              pointBackgroundColor: 'rgba(37, 99, 235, 1)',
              borderWidth: 2
            },
            {
              label: 'เกณฑ์มาตรฐานเป้าหมาย',
              data: [2.50, 2.50, 2.50, 2.50, 2.50, 2.50, 2.50, 2.50, 2.50],
              borderColor: 'rgba(217, 119, 6, 0.7)',
              borderDash: [5, 5],
              borderWidth: 1.5,
              fill: false,
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              min: 0,
              max: 3,
              ticks: { stepSize: 0.5, font: { family: 'Sarabun' } },
              pointLabels: { font: { family: 'Prompt', size: 11 } }
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { font: { family: 'Sarabun' } } }
          }
        }
      });
    }

    // 2. Bar Chart: School Groups
    const barCanvas = document.getElementById('admin-group-bar-chart');
    if (barCanvas) {
      if (window.adminBarChartInstance) {
        window.adminBarChartInstance.destroy();
      }

      const schools = window.NAN1_SCHOOLS || [];
      const groups = [...new Set(schools.map(s => s.group))].sort();
      const avgData = groups.map(g => {
        const gSubs = subs.filter(s => s.schoolGroup === g);
        if (gSubs.length === 0) return 0;
        return Number((gSubs.reduce((acc, curr) => acc + curr.scoreAvg, 0) / gSubs.length).toFixed(2));
      });

      window.adminBarChartInstance = new Chart(barCanvas, {
        type: 'bar',
        data: {
          labels: groups,
          datasets: [{
            label: 'คะแนนเฉลี่ยการขับเคลื่อน EF',
            data: avgData,
            backgroundColor: avgData.map(v => v >= 2.5 ? 'rgba(5, 150, 105, 0.8)' : v > 0 ? 'rgba(37, 99, 235, 0.8)' : 'rgba(203, 213, 225, 0.6)'),
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { min: 0, max: 3, ticks: { font: { family: 'Sarabun' } } },
            x: { ticks: { font: { family: 'Prompt', size: 10 } } }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }
  }

  function renderAdminSchoolTable() {
    const tbody = document.getElementById('admin-school-table-body');
    if (!tbody) return;

    const schools = window.NAN1_SCHOOLS || [];
    const searchVal = ((document.getElementById('admin-table-search') || {}).value || '').trim().toLowerCase();
    const groupVal = ((document.getElementById('admin-table-group-filter') || {}).value || 'all');
    const statusVal = ((document.getElementById('admin-table-status-filter') || {}).value || 'all');

    const subs = state.submissions || [];

    const filtered = schools.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(searchVal) || s.id.toLowerCase().includes(searchVal);
      const matchGroup = groupVal === 'all' || s.group === groupVal;
      if (!matchSearch || !matchGroup) return false;

      const sSubs = subs.filter(sub => sub.schoolId === s.id);
      const sSup = sSubs.filter(x => x.type === 'supervisor');
      const sSch = sSubs.filter(x => x.type === 'school');
      const sTch = sSubs.filter(x => x.type === 'teacher');
      const sStu = sSubs.filter(x => x.type && x.type.startsWith('student_'));
      const sPar = sSubs.filter(x => x.type && x.type.startsWith('parent_'));

      // Core school mandatory sets (4 sets: รร. + ครู + นร. + ผปค. >= 1 คน)
      let schoolSetsCompleted = 0;
      if (sSch.length > 0) schoolSetsCompleted++;
      if (sTch.length > 0) schoolSetsCompleted++;
      if (sStu.length > 0) schoolSetsCompleted++;
      if (sPar.length >= 1) schoolSetsCompleted++; // Minimum 1 parent

      const hasSup = sSup.length > 0;
      const isSchoolCompleted = schoolSetsCompleted === 4;

      if (statusVal === 'completed' && !isSchoolCompleted) return false;
      if (statusVal === 'partial' && (schoolSetsCompleted === 0 || isSchoolCompleted)) return false;
      if (statusVal === 'none' && (schoolSetsCompleted > 0 || hasSup)) return false;
      if (statusVal === 'has_sup' && !hasSup) return false;
      if (statusVal === 'has_sch' && sSch.length === 0) return false;
      if (statusVal === 'has_tch' && sTch.length === 0) return false;
      if (statusVal === 'has_stu' && sStu.length === 0) return false;
      if (statusVal === 'has_par' && sPar.length === 0) return false;
      if (statusVal === 'missing_sch' && sSch.length > 0) return false;
      if (statusVal === 'missing_tch' && sTch.length > 0) return false;
      if (statusVal === 'missing_stu' && sStu.length > 0) return false;
      if (statusVal === 'missing_par' && sPar.length >= 1) return false;

      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="p-8 text-center text-slate-400">
            <i class="fas fa-search text-2xl mb-2 block"></i>
            ไม่พบสถานศึกษาตามเงื่อนไขการค้นหาหรือตัวกรอง
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(s => {
      const sSubs = subs.filter(sub => sub.schoolId === s.id);
      const sSup = sSubs.filter(x => x.type === 'supervisor');
      const sSch = sSubs.filter(x => x.type === 'school');
      const sTch = sSubs.filter(x => x.type === 'teacher');
      const sStu = sSubs.filter(x => x.type && x.type.startsWith('student_'));
      const sPar = sSubs.filter(x => x.type && x.type.startsWith('parent_'));

      // Core school mandatory sets (4 sets: รร. + ครู + นร. + ผปค. >= 1 คน)
      let schoolSetsCompleted = 0;
      if (sSch.length > 0) schoolSetsCompleted++;
      if (sTch.length > 0) schoolSetsCompleted++;
      if (sStu.length > 0) schoolSetsCompleted++;
      if (sPar.length >= 1) schoolSetsCompleted++; // Minimum 1 parent

      const hasSup = sSup.length > 0;
      const isSchoolCompleted = schoolSetsCompleted === 4;

      const sAvg = sSubs.length > 0 ? (sSubs.reduce((a, b) => a + (Number(b.scoreAvg) || 0), 0) / sSubs.length).toFixed(2) : '-';

      let statusBadge = '';
      if (isSchoolCompleted) {
        if (hasSup) {
          statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800" title="ครบเกณฑ์ 4 ชุดสถานศึกษา + นิเทศแล้ว"><i class="fas fa-check-double text-[10px]"></i> ครบเกณฑ์ (+ศน.)</span>';
        } else {
          statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800" title="ส่งครบ 4 ชุดหลักของสถานศึกษา (ผปค. ≥ 1 คน)"><i class="fas fa-check-circle text-[10px]"></i> ครบเกณฑ์ (4/4)</span>';
        }
      } else if (schoolSetsCompleted > 0 || hasSup) {
        statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800"><i class="fas fa-spinner fa-spin text-[10px]"></i> กำลังทำ (${schoolSetsCompleted}/4 ชุด)</span>`;
      } else {
        statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500"><i class="fas fa-minus-circle text-[10px]"></i> ยังไม่เริ่ม</span>';
      }

      // 5 Sets mini indicators
      const badgeSup = sSup.length > 0 
        ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800" title="ศึกษานิเทศก์: นิเทศแล้ว ${sSup.length} ชุด (นิเทศเฉพาะกลุ่มเป้าหมาย)"><i class="fas fa-check text-[8px] mr-1"></i>ศน.(${sSup.length})</span>`
        : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-400" title="ศึกษานิเทศก์: รอการนิเทศ (ไม่บังคับทุก รร.)"><i class="fas fa-minus text-[8px] mr-1"></i>ศน.</span>`;

      const badgeSch = sSch.length > 0 
        ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800" title="สถานศึกษา: ส่งแล้ว"><i class="fas fa-check text-[8px] mr-1"></i>รร.</span>`
        : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-400" title="สถานศึกษา: ยังไม่ส่ง"><i class="fas fa-minus text-[8px] mr-1"></i>รร.</span>`;

      const badgeTch = sTch.length > 0 
        ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800" title="ครูผู้สอน: ส่งแล้ว ${sTch.length} คน"><i class="fas fa-check text-[8px] mr-1"></i>ครู(${sTch.length})</span>`
        : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-400" title="ครูผู้สอน: ยังไม่ส่ง"><i class="fas fa-minus text-[8px] mr-1"></i>ครู</span>`;

      const badgeStu = sStu.length > 0 
        ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800" title="นักเรียน: ประเมินแล้ว ${sStu.length} คน"><i class="fas fa-check text-[8px] mr-1"></i>นร.(${sStu.length})</span>`
        : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-400" title="นักเรียน: ยังไม่ประเมิน"><i class="fas fa-minus text-[8px] mr-1"></i>นร.</span>`;

      const badgePar = sPar.length >= 1 
        ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800" title="ผู้ปกครอง: ผ่านเกณฑ์ขั้นต่ำ (ตอบแล้ว ${sPar.length} คน)"><i class="fas fa-check text-[8px] mr-1"></i>ผปค.(${sPar.length})</span>`
        : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-rose-50 text-rose-400 border border-rose-200" title="ผู้ปกครอง: ยังไม่ถึงเกณฑ์ขั้นต่ำ (อย่างน้อย 1 คน)"><i class="fas fa-minus text-[8px] mr-1"></i>ผปค.(0)</span>`;

      return `
        <tr class="hover:bg-slate-50/80 transition">
          <td class="p-3 text-center font-mono text-slate-500">${s.id}</td>
          <td class="p-3">
            <strong class="text-slate-800 block text-xs">${s.name}</strong>
          </td>
          <td class="p-3 text-slate-600">
            <div>${s.group}</div>
            <div class="text-[10px] text-slate-400">${s.district}</div>
          </td>
          <td class="p-3 text-center">
            <div class="font-semibold text-slate-700">${s.totalStudents}</div>
            <div class="text-[10px] text-slate-400">${s.schoolSize}</div>
          </td>
          <td class="p-3 text-center">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              ${badgeSup}
              ${badgeSch}
              ${badgeTch}
              ${badgeStu}
              ${badgePar}
            </div>
          </td>
          <td class="p-3 text-center font-bold text-slate-800">${sSubs.length}</td>
          <td class="p-3 text-center">
            <strong class="text-sm ${sAvg !== '-' ? (Number(sAvg) >= 2.5 ? 'text-emerald-700' : Number(sAvg) >= 1.8 ? 'text-blue-700' : 'text-amber-700') : 'text-slate-400'}">${sAvg}</strong>
          </td>
          <td class="p-3 text-center">${statusBadge}</td>
          <td class="p-3 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="window.EF_APP.openSchoolProgressModal('${s.id}')" class="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold shadow-sm transition flex items-center gap-1" title="ตรวจสอบความคืบหน้ารายชุดและรายด้าน">
                <i class="fas fa-search-plus"></i> ตรวจสอบ
              </button>
              <button onclick="window.EF_APP.viewSchoolReport('${s.id}')" class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition" title="ดูหน้ารายงานสถานศึกษา">
                <i class="fas fa-file-alt"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- RENDER ADMIN MEDIA & EVIDENCE GALLERY HUB ---
  function renderAdminMediaGallery() {
    const container = document.getElementById('admin-media-gallery-container');
    if (!container) return;

    const allItems = getAllMediaItems();
    const searchVal = (state.mediaSearchQuery || '').trim().toLowerCase();
    const typeFilter = state.mediaFilterType || 'all';
    const groupFilter = state.mediaFilterGroup || 'all';
    const instFilter = state.mediaFilterInstrument || 'all';

    const filtered = allItems.filter(item => {
      const matchSearch = !searchVal || 
        item.name.toLowerCase().includes(searchVal) ||
        item.schoolName.toLowerCase().includes(searchVal) ||
        (item.evaluator && item.evaluator.toLowerCase().includes(searchVal)) ||
        (item.submissionId && item.submissionId.toLowerCase().includes(searchVal));

      let matchType = true;
      if (typeFilter === 'image') matchType = item.isImage;
      else if (typeFilter === 'pdf') matchType = item.isPdf;
      else if (typeFilter === 'doc') matchType = item.isDoc;

      const matchGroup = groupFilter === 'all' || item.schoolGroup === groupFilter;
      
      let matchInst = true;
      if (instFilter === 'supervisor') matchInst = item.formType === 'supervisor';
      else if (instFilter === 'school') matchInst = item.formType === 'school';
      else if (instFilter === 'teacher') matchInst = item.formType === 'teacher';

      return matchSearch && matchType && matchGroup && matchInst;
    });

    const totalImages = allItems.filter(x => x.isImage).length;
    const totalDocs = allItems.filter(x => x.isPdf || x.isDoc).length;
    const uniqueSchoolsWithMedia = new Set(allItems.filter(x => x.schoolId).map(x => x.schoolId)).size;
    const groups = window.NAN1_SCHOOLS ? [...new Set(window.NAN1_SCHOOLS.map(s => s.group))].sort() : [];

    container.innerHTML = `
      <!-- Media Stats Summary KPI Cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200">
          <div class="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>ไฟล์และสื่อทั้งหมด</span>
            <i class="fas fa-folder-open text-blue-600"></i>
          </div>
          <div class="text-2xl font-bold text-slate-900">${allItems.length} <span class="text-xs font-normal text-slate-400">รายการ</span></div>
        </div>

        <div class="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200">
          <div class="flex items-center justify-between text-xs text-emerald-700 mb-1">
            <span>รูปภาพร่องรอยกิจกรรม</span>
            <i class="fas fa-images text-emerald-600"></i>
          </div>
          <div class="text-2xl font-bold text-emerald-800">${totalImages} <span class="text-xs font-normal text-emerald-600">ภาพ</span></div>
        </div>

        <div class="p-4 rounded-2xl bg-sky-50/50 border border-sky-200">
          <div class="flex items-center justify-between text-xs text-sky-700 mb-1">
            <span>เอกสาร PDF / บันทึกนิเทศ</span>
            <i class="fas fa-file-pdf text-rose-500"></i>
          </div>
          <div class="text-2xl font-bold text-sky-800">${totalDocs} <span class="text-xs font-normal text-sky-600">ไฟล์</span></div>
        </div>

        <div class="p-4 rounded-2xl bg-amber-50/50 border border-amber-200">
          <div class="flex items-center justify-between text-xs text-amber-700 mb-1">
            <span>โรงเรียนที่มีร่องรอยแนบ</span>
            <i class="fas fa-school text-amber-600"></i>
          </div>
          <div class="text-2xl font-bold text-amber-800">${uniqueSchoolsWithMedia} <span class="text-xs font-normal text-amber-600">แห่ง</span></div>
        </div>
      </div>

      <!-- Search, Filter & Action Toolbar -->
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-6 p-4 rounded-2xl bg-slate-50 border border-slate-200">
        <div class="flex flex-wrap items-center gap-2 flex-1">
          <div class="relative min-w-[200px] flex-1 sm:flex-initial">
            <i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
            <input type="text" id="admin-media-search-input" value="${state.mediaSearchQuery || ''}" 
              placeholder="ค้นหาชื่อไฟล์, โรงเรียน, ผู้ประเมิน..." 
              oninput="window.EF_APP.onMediaSearchChange(this.value)"
              class="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none">
          </div>

          <!-- Type Filters -->
          <div class="flex items-center bg-white p-1 rounded-xl border border-slate-300 text-xs">
            <button onclick="window.EF_APP.setMediaFilterType('all')" class="px-2.5 py-1 rounded-lg font-semibold transition ${typeFilter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'}">
              ทั้งหมด
            </button>
            <button onclick="window.EF_APP.setMediaFilterType('image')" class="px-2.5 py-1 rounded-lg font-semibold transition flex items-center gap-1 ${typeFilter === 'image' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-slate-900'}">
              <i class="fas fa-image text-[10px]"></i> ภาพถ่าย (${totalImages})
            </button>
            <button onclick="window.EF_APP.setMediaFilterType('pdf')" class="px-2.5 py-1 rounded-lg font-semibold transition flex items-center gap-1 ${typeFilter === 'pdf' ? 'bg-rose-600 text-white' : 'text-slate-600 hover:text-slate-900'}">
              <i class="fas fa-file-pdf text-[10px]"></i> PDF
            </button>
            <button onclick="window.EF_APP.setMediaFilterType('doc')" class="px-2.5 py-1 rounded-lg font-semibold transition flex items-center gap-1 ${typeFilter === 'doc' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'}">
              <i class="fas fa-file-word text-[10px]"></i> Word
            </button>
          </div>

          <!-- Instrument Filter -->
          <select onchange="window.EF_APP.setMediaFilterInstrument(this.value)" class="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none">
            <option value="all" ${instFilter === 'all' ? 'selected' : ''}>ทุกชุดแบบประเมิน</option>
            <option value="supervisor" ${instFilter === 'supervisor' ? 'selected' : ''}>ชุดที่ 1 : ศึกษานิเทศก์</option>
            <option value="school" ${instFilter === 'school' ? 'selected' : ''}>ชุดที่ 2 : สถานศึกษา</option>
            <option value="teacher" ${instFilter === 'teacher' ? 'selected' : ''}>ชุดที่ 3 : ครูผู้สอน</option>
          </select>

          <!-- Group Filter -->
          <select onchange="window.EF_APP.setMediaFilterGroup(this.value)" class="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none">
            <option value="all">ทุกกลุ่มโรงเรียน</option>
            ${groups.map(g => `<option value="${g}" ${groupFilter === g ? 'selected' : ''}>${g}</option>`).join('')}
          </select>
        </div>

        <!-- Right Side Actions: View Switcher, Drive Refresh & Manifest Export -->
        <div class="flex items-center gap-2 shrink-0">
          <div class="flex items-center bg-white p-1 rounded-xl border border-slate-300 text-xs">
            <button onclick="window.EF_APP.setMediaViewMode('grid')" class="p-1.5 px-2 rounded-lg transition ${state.mediaViewMode === 'grid' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-900'}" title="โหมดการ์ดภาพถ่าย">
              <i class="fas fa-th-large"></i>
            </button>
            <button onclick="window.EF_APP.setMediaViewMode('table')" class="p-1.5 px-2 rounded-lg transition ${state.mediaViewMode === 'table' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-900'}" title="โหมดตารางรายการ">
              <i class="fas fa-list"></i>
            </button>
          </div>

          <button onclick="window.EF_APP.fetchDriveUploadedFiles()" class="px-3 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-sm transition" title="ดึงรายการไฟล์ล่าสุดจาก Google Drive">
            <i class="fas fa-sync-alt ${state.isDriveFilesLoading ? 'fa-spin text-blue-600' : 'text-slate-500'}"></i>
            <span class="hidden sm:inline">โหลดจาก Drive</span>
          </button>

          <a href="${PROJECT_DRIVE_FOLDER_URL}" target="_blank" class="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition" title="เปิดโฟลเดอร์ Google Drive รวมโครงการ">
            <i class="fab fa-google-drive"></i>
            <span>เปิด Google Drive โครงการ</span>
          </a>

          <button onclick="window.EF_APP.exportMediaManifestToExcel()" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition" title="ส่งออกตารางบัญชีไฟล์แนบเป็น Excel สำหรับทำรายงาน">
            <i class="fas fa-file-excel"></i>
            <span class="hidden sm:inline">ส่งออกบัญชีไฟล์ Excel</span>
          </button>
        </div>
      </div>

      <!-- Main Gallery Container -->
      ${filtered.length === 0 ? `
        <div class="text-center py-12 px-4 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center text-2xl mx-auto mb-3">
            <i class="fas fa-photo-video"></i>
          </div>
          <h4 class="text-sm font-bold text-slate-700 mb-1">ยังไม่พบไฟล์หรือรูปภาพตามเงื่อนไขที่เลือก</h4>
          <p class="text-xs text-slate-400 max-w-md mx-auto mb-4">
            ท่านสามารถทดลองอัปโหลดไฟล์ในแบบประเมินชุดที่ 1 (ศน.), ชุดที่ 2 (รร.), หรือชุดที่ 3 (ครู) หรือกดปุ่ม "โหลดจาก Drive" เพื่อดึงไฟล์ที่มีอยู่
          </p>
          <a href="${PROJECT_DRIVE_FOLDER_URL}" target="_blank" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-50 text-blue-700 font-bold text-xs hover:bg-blue-100 transition">
            <i class="fab fa-google-drive"></i>
            <span>เปิดดูใน Google Drive โฟลเดอร์รวม</span>
          </a>
        </div>
      ` : state.mediaViewMode === 'table' ? `
        <!-- Table View -->
        <div class="overflow-x-auto border border-slate-200 rounded-2xl bg-white shadow-sm">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th class="p-3 w-16 text-center">ตัวอย่าง</th>
                <th class="p-3">ชื่อไฟล์ / ร่องรอยหลักฐาน</th>
                <th class="p-3">ประเภท</th>
                <th class="p-3">สถานศึกษา</th>
                <th class="p-3">กลุ่ม / อำเภอ</th>
                <th class="p-3">ชุดการประเมิน / ผู้ส่ง</th>
                <th class="p-3 text-center">วันที่บันทึก</th>
                <th class="p-3 text-center w-36">เครื่องมือทำรายงาน</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${filtered.map(item => {
                const directUrl = item.url || '#';
                const isImage = item.isImage;
                const isPdf = item.isPdf;
                const isDoc = item.isDoc;
                const displaySize = item.size ? (item.size >= 1024 * 1024 ? (item.size / (1024 * 1024)).toFixed(2) + ' MB' : (item.size / 1024).toFixed(1) + ' KB') : '-';
                const imgSrc = item.base64 || item.thumbnailUrl || directUrl;
                
                return `
                  <tr class="hover:bg-slate-50/80 transition">
                    <td class="p-2 text-center">
                      <div class="w-12 h-12 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center cursor-pointer mx-auto shadow-sm" onclick="window.EF_APP.openMediaLightbox('${item.id}')">
                        ${isImage ? `
                          <img src="${imgSrc}" alt="${item.name}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-image text-slate-400\\'></i>'">
                        ` : `
                          <i class="${isPdf ? 'fas fa-file-pdf text-rose-500 text-lg' : isDoc ? 'fas fa-file-word text-blue-600 text-lg' : 'fas fa-file-alt text-slate-500 text-lg'}"></i>
                        `}
                      </div>
                    </td>
                    <td class="p-3 font-medium text-slate-800">
                      <div class="font-bold text-slate-900 line-clamp-1 cursor-pointer hover:text-blue-600 transition" onclick="window.EF_APP.openMediaLightbox('${item.id}')" title="${item.name}">${item.name}</div>
                      <div class="text-[11px] text-slate-400 font-mono mt-0.5">${displaySize}</div>
                    </td>
                    <td class="p-3">
                      <span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${isImage ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : isPdf ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
                        <i class="${isImage ? 'fas fa-image' : isPdf ? 'fas fa-file-pdf' : 'fas fa-file-alt'} text-[9px]"></i>
                        ${isImage ? 'รูปภาพ' : isPdf ? 'PDF' : isDoc ? 'Word' : 'เอกสาร'}
                      </span>
                    </td>
                    <td class="p-3 text-slate-700 font-semibold">${item.schoolName}</td>
                    <td class="p-3 text-slate-500 text-[11px]">${item.schoolGroup} (${item.district})</td>
                    <td class="p-3">
                      <div class="text-slate-800 font-medium">${item.formTypeName}</div>
                      <div class="text-[11px] text-slate-500">${item.evaluator}</div>
                    </td>
                    <td class="p-3 text-center text-slate-500 font-mono text-[11px]">${formatThaiDate(item.date)}</td>
                    <td class="p-3 text-center">
                      <div class="flex items-center justify-center gap-1">
                        <button onclick="window.EF_APP.openMediaLightbox('${item.id}')" class="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold transition" title="เปิดดูภาพ/เอกสาร">
                          <i class="fas fa-search-plus text-xs"></i>
                        </button>
                        <button onclick="window.EF_APP.copyMediaUrl('${directUrl}')" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition" title="คัดลอกลิงก์">
                          <i class="fas fa-link text-xs"></i>
                        </button>
                        <a href="${directUrl}" target="_blank" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-blue-600 transition" title="เปิดใน Google Drive">
                          <i class="fab fa-google-drive text-xs"></i>
                        </a>
                        <a href="${item.downloadUrl || directUrl}" target="_blank" download="${item.name}" class="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition" title="ดาวน์โหลด">
                          <i class="fas fa-download text-xs"></i>
                        </a>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <!-- Card / Grid View -->
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          ${filtered.map(item => {
            const directUrl = item.url || '#';
            const isImage = item.isImage;
            const isPdf = item.isPdf;
            const isDoc = item.isDoc;
            const displaySize = item.size ? (item.size >= 1024 * 1024 ? (item.size / (1024 * 1024)).toFixed(2) + ' MB' : (item.size / 1024).toFixed(1) + ' KB') : 'ไฟล์แนบ';
            const imgSrc = item.base64 || item.thumbnailUrl || directUrl;

            return `
              <div class="media-card bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between hover:border-blue-300">
                <!-- Media Thumbnail / Preview Area -->
                <div class="relative h-44 bg-slate-950 flex items-center justify-center overflow-hidden cursor-pointer group" onclick="window.EF_APP.openMediaLightbox('${item.id}')">
                  ${isImage ? `
                    <img src="${imgSrc}" alt="${item.name}" class="media-thumb w-full h-full object-cover" onerror="this.parentElement.innerHTML='<div class=\\'flex flex-col items-center justify-center text-slate-400\\'><i class=\\'fas fa-image text-3xl mb-1\\'></i><span class=\\'text-[10px]\\'>Image Preview</span></div>'">
                  ` : `
                    <div class="flex flex-col items-center justify-center text-white space-y-2 p-4 text-center">
                      <div class="w-14 h-14 rounded-2xl ${isPdf ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : isDoc ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-slate-700/50 text-slate-300 border border-slate-600'} flex items-center justify-center text-2xl shadow-inner">
                        <i class="${isPdf ? 'fas fa-file-pdf' : isDoc ? 'fas fa-file-word' : 'fas fa-file-alt'}"></i>
                      </div>
                      <span class="text-[11px] text-slate-300 font-semibold line-clamp-1 px-2">${item.name}</span>
                    </div>
                  `}

                  <!-- Badge Overlay -->
                  <div class="absolute top-2.5 left-2.5">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-md ${isImage ? 'bg-emerald-600 text-white' : isPdf ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white'}">
                      <i class="${isImage ? 'fas fa-image' : isPdf ? 'fas fa-file-pdf' : 'fas fa-file-alt'} mr-1"></i>
                      ${isImage ? 'รูปภาพ' : isPdf ? 'PDF' : isDoc ? 'Word' : 'เอกสาร'}
                    </span>
                  </div>

                  <div class="absolute top-2.5 right-2.5">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-900/80 backdrop-blur-sm text-slate-200 border border-slate-700/80">
                      ${displaySize}
                    </span>
                  </div>

                  <!-- Hover Action Overlay -->
                  <div class="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                    <button type="button" class="w-10 h-10 rounded-full bg-white/90 hover:bg-white text-slate-900 flex items-center justify-center text-sm shadow-lg transition" title="ขยายดูภาพ/เอกสารเต็มจอ">
                      <i class="fas fa-search-plus text-blue-600"></i>
                    </button>
                  </div>
                </div>

                <!-- Card Content -->
                <div class="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <h5 class="text-xs font-bold text-slate-900 line-clamp-2 mb-1.5 leading-snug cursor-pointer hover:text-blue-600 transition" onclick="window.EF_APP.openMediaLightbox('${item.id}')" title="${item.name}">
                      ${item.name}
                    </h5>

                    <div class="space-y-1 text-[11px] text-slate-600 mb-3">
                      <div class="flex items-center gap-1.5 font-semibold text-slate-800 truncate">
                        <i class="fas fa-school text-blue-600 text-[10px]"></i>
                        <span class="truncate">${item.schoolName}</span>
                      </div>
                      <div class="flex items-center justify-between text-slate-500 text-[10px]">
                        <span>${item.schoolGroup} (${item.district})</span>
                        <span class="font-mono">${formatThaiDate(item.date)}</span>
                      </div>
                      <div class="text-[10px] text-slate-500 truncate">
                        <i class="fas fa-user-check text-[9px] text-slate-400 mr-1"></i> ${item.evaluator} (${item.formTypeName})
                      </div>
                    </div>
                  </div>

                  <!-- Card Action Footer -->
                  <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-1.5">
                    <button onclick="window.EF_APP.openMediaLightbox('${item.id}')" class="flex-1 py-1.5 px-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] flex items-center justify-center gap-1 transition">
                      <i class="fas fa-search-plus text-[10px]"></i>
                      <span>เปิดดู</span>
                    </button>

                    <button onclick="window.EF_APP.copyMediaUrl('${directUrl}')" class="p-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition" title="คัดลอกลิงก์ไฟล์">
                      <i class="fas fa-copy text-amber-500"></i>
                    </button>

                    <a href="${directUrl}" target="_blank" class="p-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-blue-600 text-[11px] font-semibold transition" title="เปิดใน Google Drive">
                      <i class="fab fa-google-drive"></i>
                    </a>

                    <a href="${item.downloadUrl || directUrl}" target="_blank" download="${item.name}" class="p-1.5 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-semibold transition" title="ดาวน์โหลดไฟล์">
                      <i class="fas fa-download"></i>
                    </a>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    `;
  }

  // Dedicated School Progress & Audit Modal (ตรวจสอบความคืบหน้ารายโรงเรียน)
  function openSchoolProgressModal(schoolId) {
    const existing = document.getElementById('school-progress-modal');
    if (existing) existing.remove();

    const school = (window.NAN1_SCHOOLS || []).find(s => s.id === schoolId);
    if (!school) {
      showToast('ไม่พบข้อมูลสถานศึกษา', 'error');
      return;
    }

    const subs = state.submissions || [];
    const schoolSubs = subs.filter(s => s.schoolId === school.id);

    // 1. 5 Sets Submissions Data
    const sSup = schoolSubs.filter(s => s.type === 'supervisor');
    const sSch = schoolSubs.filter(s => s.type === 'school');
    const sTch = schoolSubs.filter(s => s.type === 'teacher');
    const sStu = schoolSubs.filter(s => s.type && s.type.startsWith('student_'));
    const sPar = schoolSubs.filter(s => s.type && s.type.startsWith('parent_'));

    const tchEarly = sTch.filter(s => s.teachingStage === 'early' || (s.gradeLevel && s.gradeLevel.startsWith('a'))).length;
    const tchPrimary = sTch.length - tchEarly;

    const stuEarly = sStu.filter(s => s.type === 'student_early').length;
    const stuPrimary = sStu.filter(s => s.type === 'student_primary').length;

    const parEarly = sPar.filter(s => s.type === 'parent_early').length;
    const parPrimary = sPar.filter(s => s.type === 'parent_primary').length;

    // Core school mandatory sets (4 sets: รร. + ครู + นร. + ผปค. >= 1 คน)
    let schoolSetsCompleted = 0;
    if (sSch.length > 0) schoolSetsCompleted++;
    if (sTch.length > 0) schoolSetsCompleted++;
    if (sStu.length > 0) schoolSetsCompleted++;
    if (sPar.length >= 1) schoolSetsCompleted++; // Minimum 1 parent per school

    const hasSup = sSup.length > 0;
    const progressPct = Math.round((schoolSetsCompleted / 4) * 100);

    const schoolAvgScore = schoolSubs.length > 0 ? (schoolSubs.reduce((a, b) => a + (Number(b.scoreAvg) || 0), 0) / schoolSubs.length).toFixed(2) : '-';
    let qualityBadge = 'ยังไม่มีข้อมูลการประเมิน';
    let qualityColor = 'bg-slate-100 text-slate-600';
    if (schoolSubs.length > 0) {
      const num = Number(schoolAvgScore);
      if (num >= 2.5) { qualityBadge = 'ระดับดีมาก / เติบโตยั่งยืน'; qualityColor = 'bg-emerald-100 text-emerald-800'; }
      else if (num >= 1.8) { qualityBadge = 'ระดับพอใช้ / กำลังพัฒนา'; qualityColor = 'bg-blue-100 text-blue-800'; }
      else { qualityBadge = 'ระดับควรหนุนเสริม'; qualityColor = 'bg-amber-100 text-amber-800'; }
    }

    // 2. 9 EF Domains Calculation for this school
    const domainDef = [
      { key: 'wm', name: '1. ความจำที่นำมาใช้งาน (Working Memory)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'ic', name: '2. การยั้งคิดไตร่ตรอง (Inhibitory Control)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'sh', name: '3. ความยืดหยุ่นทางความคิด (Shift)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'fo', name: '4. การจดจ่อใส่ใจ (Focus / Attention)', group: 'กลุ่มที่ 2 : ทักษะกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'ec', name: '5. การควบคุมอารมณ์ (Emotional Control)', group: 'กลุ่มที่ 2 : ทักษะกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'sm', name: '6. การติดตามประเมินตนเอง (Self-Monitoring)', group: 'กลุ่มที่ 2 : ทักษะกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'in', name: '7. การริเริ่มและลงมือทำ (Initiating)', group: 'กลุ่มที่ 3 : ทักษะลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' },
      { key: 'po', name: '8. การวางแผนและการจัดระบบ (Planning)', group: 'กลุ่มที่ 3 : ทักษะลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' },
      { key: 'gp', name: '9. การมุ่งเป้าหมาย (Goal-Directed)', group: 'กลุ่มที่ 3 : ทักษะลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' }
    ];

    const schoolDomainStats = domainDef.map(d => {
      let scores = [];
      if (schoolSubs.length > 0) {
        schoolSubs.forEach(s => {
          if (s.domainScores && typeof s.domainScores[d.key] === 'number') {
            scores.push(s.domainScores[d.key]);
          } else if (s.answers && typeof s.answers === 'object') {
            const matchingKeys = Object.keys(s.answers).filter(k => k.includes(`_${d.key}_`) || k.startsWith(`${d.key}_`));
            if (matchingKeys.length > 0) {
              const vals = matchingKeys.map(k => Number(s.answers[k])).filter(v => !isNaN(v));
              if (vals.length > 0) scores.push(vals.reduce((a, b) => a + b, 0) / vals.length);
            } else if (typeof s.scoreAvg === 'number' && s.scoreAvg > 0) {
              scores.push(s.scoreAvg);
            }
          } else if (typeof s.scoreAvg === 'number' && s.scoreAvg > 0) {
            scores.push(s.scoreAvg);
          }
        });
      }

      const count = scores.length;
      const avg = count > 0 ? scores.reduce((a, b) => a + b, 0) / count : 0;
      let sd = 0;
      if (count > 1) {
        const variance = scores.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / (count - 1);
        sd = Math.sqrt(variance);
      }
      const pct = (avg / 3.0) * 100;
      let quality = count > 0 ? (avg >= 2.5 ? 'ระดับดีมาก' : avg >= 1.8 ? 'ระดับพอใช้' : 'ควรหนุนเสริม') : 'รอข้อมูล';
      let qColor = count > 0 ? (avg >= 2.5 ? 'bg-emerald-100 text-emerald-800' : avg >= 1.8 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800') : 'bg-slate-100 text-slate-500';
      let barColor = avg >= 2.5 ? 'bg-emerald-500' : avg >= 1.8 ? 'bg-blue-600' : 'bg-amber-500';

      return {
        ...d,
        count,
        avg: count > 0 ? avg.toFixed(2) : '-',
        sd: count > 1 ? sd.toFixed(2) : '-',
        pct: count > 0 ? pct.toFixed(1) + '%' : '0%',
        pctNum: pct,
        quality,
        qColor,
        barColor,
        numAvg: avg
      };
    });

    const basicDomains = schoolDomainStats.filter(d => d.groupKey === 'basic');
    const basicScore = basicDomains.some(d => d.count > 0) ? (basicDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2) : '-';

    const selfDomains = schoolDomainStats.filter(d => d.groupKey === 'self');
    const selfScore = selfDomains.some(d => d.count > 0) ? (selfDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2) : '-';

    const practiceDomains = schoolDomainStats.filter(d => d.groupKey === 'practice');
    const practiceScore = practiceDomains.some(d => d.count > 0) ? (practiceDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2) : '-';

    const modal = document.createElement('div');
    modal.id = 'school-progress-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto animate-fade-in';
    modal.innerHTML = `
      <div class="bg-white rounded-3xl max-w-5xl w-full p-6 md:p-8 shadow-2xl border border-slate-200 my-8 max-h-[90vh] overflow-y-auto space-y-8">
        
        <!-- Modal Header -->
        <div class="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-100 gap-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-700 to-indigo-900 text-amber-300 flex items-center justify-center text-xl font-bold shadow-md shadow-blue-500/20">
              <i class="fas fa-school"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">${school.id}</span>
                <span class="text-xs text-slate-500">${school.group} • ${school.district}</span>
              </div>
              <h2 class="text-xl md:text-2xl font-bold text-slate-800 mt-0.5">${school.name}</h2>
              <p class="text-xs text-slate-500">ขนาด: <strong>${school.schoolSize}</strong> • จำนวนนักเรียนรวม: <strong>${school.totalStudents}</strong> คน</p>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button onclick="window.EF_APP.viewSchoolReport('${school.id}'); document.getElementById('school-progress-modal').remove();" class="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition">
              <i class="fas fa-file-alt"></i>
              <span>หน้ารายงานเต็ม</span>
            </button>
            <button onclick="document.getElementById('school-progress-modal').remove()" class="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-base transition">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>

        <!-- Overall Progress KPIs -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="p-5 rounded-2xl bg-gradient-to-br from-blue-900 to-indigo-950 text-white shadow-lg">
            <span class="text-xs font-semibold text-blue-200 uppercase tracking-wider">ความคืบหน้าเกณฑ์สถานศึกษา</span>
            <div class="text-3xl font-bold text-white mt-2 mb-1">${schoolSetsCompleted} / 4 <span class="text-sm font-normal text-slate-300">ชุด (${progressPct}%)</span></div>
            <div class="w-full bg-blue-950/80 rounded-full h-2 mt-3 overflow-hidden">
              <div class="bg-amber-400 h-2 rounded-full" style="width: ${progressPct}%"></div>
            </div>
            ${hasSup ? `<p class="text-[11px] text-emerald-300 font-semibold mt-2"><i class="fas fa-check-circle mr-1"></i>มีบันทึกนิเทศของ ศน. (${sSup.length} ชุด)</p>` : ''}
          </div>

          <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
            <span class="text-xs font-semibold text-slate-500">คะแนนเฉลี่ย EF รวม</span>
            <div class="text-3xl font-bold text-blue-700 mt-2 mb-1">${schoolAvgScore} <span class="text-sm font-normal text-slate-400">/ 3.00</span></div>
            <span class="inline-block text-[10px] font-semibold ${qualityColor} px-2 py-0.5 rounded mt-2">${qualityBadge}</span>
          </div>

          <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
            <span class="text-xs font-semibold text-slate-500">จำนวนชุดข้อมูลที่ส่งทั้งหมด</span>
            <div class="text-3xl font-bold text-slate-800 mt-2 mb-1">${schoolSubs.length} <span class="text-sm font-normal text-slate-400">ชุด</span></div>
            <p class="text-[11px] text-slate-500 mt-2">รวมครู นักเรียน และผู้ปกครอง</p>
          </div>

          <div class="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
            <span class="text-xs font-semibold text-slate-500">สถานะตามเกณฑ์สถานศึกษา</span>
            <div class="text-sm font-bold mt-2 ${schoolSetsCompleted === 4 ? 'text-emerald-700' : schoolSetsCompleted > 0 ? 'text-blue-700' : 'text-slate-500'}">
              ${schoolSetsCompleted === 4 ? '✓ ครบตามเกณฑ์ 4 ชุดหลัก' : schoolSetsCompleted > 0 ? '⏳ กำลังดำเนินการ (ขาด ' + (4 - schoolSetsCompleted) + ' ชุด)' : '⭕ ยังไม่ได้เริ่มดำเนินการ'}
            </div>
            <p class="text-[11px] text-slate-500 mt-2">เกณฑ์: รร. + ครู + นร. + ผปค. ≥ 1 คน</p>
          </div>
        </div>

        <!-- 1. รายการความคืบหน้ารายชุด (5 ชุดเครื่องมือ) — ดำเนินการแล้ว / ยังไม่ได้ดำเนินการ -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-slate-800 flex items-center gap-2">
              <i class="fas fa-clipboard-check text-blue-600"></i>
              <span>1. รายการความคืบหน้ารายชุด (5 ชุดเครื่องมือประเมินมาตรฐาน)</span>
            </h3>
            <span class="text-xs text-slate-500">เกณฑ์ขั้นต่ำ: 4 ชุดหลักของสถานศึกษา (ผปค. ≥ 1 คน) • ชุด ศน. เป็นการนิเทศเฉพาะเป้าหมาย</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <!-- 1. ศึกษานิเทศก์ -->
            <div class="p-4 rounded-2xl border ${sSup.length > 0 ? 'bg-blue-50/40 border-blue-300' : 'bg-slate-50 border-slate-200'} flex flex-col justify-between space-y-3">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <i class="fas fa-user-tie text-blue-600"></i> ชุดที่ 1 : ศึกษานิเทศก์ (เขตพื้นที่)
                  </span>
                  ${sSup.length > 0 
                    ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800"><i class="fas fa-check mr-1"></i>นิเทศแล้ว</span>'
                    : '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500"><i class="fas fa-info-circle mr-1"></i>รอการนิเทศ (ไม่บังคับทุก รร.)</span>'}
                </div>
                <p class="text-[11px] text-slate-600">
                  ${sSup.length > 0 
                    ? `บันทึกการนิเทศแล้ว <strong>${sSup.length}</strong> ชุด • คะแนนเฉลี่ย: <strong class="text-blue-700">${(sSup.reduce((a,b)=>a+b.scoreAvg,0)/sSup.length).toFixed(2)}</strong>`
                    : 'การนิเทศติดตามของ ศน. เฉพาะกลุ่มเป้าหมาย (ไม่มีเกณฑ์ขั้นต่ำบังคับ)'}
                </p>
              </div>
              ${sSup.length > 0 ? `
                <div class="text-[10px] text-slate-500 pt-2 border-t border-slate-200">
                  ผู้นิเทศล่าสุด: <strong>${sSup[0].evaluator || '-'}</strong> (${formatThaiDate(sSup[0].date)})
                  ${sSup[0].attachment ? `<span class="block text-blue-600 font-bold mt-0.5"><i class="fas fa-paperclip"></i> มีไฟล์แนบ</span>` : ''}
                </div>
              ` : ''}
            </div>

            <!-- 2. สถานศึกษา -->
            <div class="p-4 rounded-2xl border ${sSch.length > 0 ? 'bg-emerald-50/40 border-emerald-300' : 'bg-slate-50 border-slate-200'} flex flex-col justify-between space-y-3">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <i class="fas fa-school text-amber-600"></i> ชุดที่ 2 : สถานศึกษา (เกณฑ์ขั้นต่ำ: 1 ชุด)
                  </span>
                  ${sSch.length > 0 
                    ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800"><i class="fas fa-check mr-1"></i>ดำเนินการแล้ว</span>'
                    : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800"><i class="fas fa-times mr-1"></i>ยังไม่ได้ดำเนินการ</span>'}
                </div>
                <p class="text-[11px] text-slate-600">
                  ${sSch.length > 0 
                    ? `บันทึกประเมินตนเองแล้ว • คะแนน: <strong class="text-amber-700">${(Number(sSch[0].scoreAvg)||0).toFixed(2)}</strong>`
                    : 'ยังไม่ได้บันทึกแบบประเมินตนเองของสถานศึกษา'}
                </p>
              </div>
              ${sSch.length > 0 ? `
                <div class="text-[10px] text-slate-500 pt-2 border-t border-slate-200">
                  ผู้บันทึก: <strong>${sSch[0].evaluator || '-'}</strong> (${formatThaiDate(sSch[0].date)})
                  ${sSch[0].attachment ? `<span class="block text-amber-700 font-bold mt-0.5"><i class="fas fa-paperclip"></i> มีไฟล์แนบ</span>` : ''}
                </div>
              ` : ''}
            </div>

            <!-- 3. ครูผู้สอน -->
            <div class="p-4 rounded-2xl border ${sTch.length > 0 ? 'bg-emerald-50/40 border-emerald-300' : 'bg-slate-50 border-slate-200'} flex flex-col justify-between space-y-3">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <i class="fas fa-chalkboard-teacher text-emerald-600"></i> ชุดที่ 3 : ครูผู้สอน (เกณฑ์ขั้นต่ำ: 1 คน)
                  </span>
                  ${sTch.length > 0 
                    ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800"><i class="fas fa-check mr-1"></i>ดำเนินการแล้ว (${sTch.length} คน)</span>`
                    : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800"><i class="fas fa-times mr-1"></i>ยังไม่ได้ดำเนินการ</span>'}
                </div>
                <p class="text-[11px] text-slate-600">
                  ${sTch.length > 0 
                    ? `ปฐมวัย: <strong>${tchEarly}</strong> คน • สุขศึกษา/พลฯ: <strong>${tchPrimary}</strong> คน • เฉลี่ย: <strong class="text-emerald-700">${(sTch.reduce((a,b)=>a+b.scoreAvg,0)/sTch.length).toFixed(2)}</strong>`
                    : 'ยังไม่มีครูผู้สอนส่งแบบประเมินตนเอง'}
                </p>
              </div>
              ${sTch.length > 0 ? `
                <div class="text-[10px] text-slate-500 pt-2 border-t border-slate-200">
                  ส่งล่าสุด: <strong>${sTch[0].evaluator || '-'}</strong> (${formatThaiDate(sTch[0].date)})
                </div>
              ` : ''}
            </div>

            <!-- 4. นักเรียน -->
            <div class="p-4 rounded-2xl border ${sStu.length > 0 ? 'bg-emerald-50/40 border-emerald-300' : 'bg-slate-50 border-slate-200'} flex flex-col justify-between space-y-3">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <i class="fas fa-child text-sky-600"></i> ชุดที่ 4 : เด็กและนักเรียน (เกณฑ์ขั้นต่ำ: 1 คน)
                  </span>
                  ${sStu.length > 0 
                    ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800"><i class="fas fa-check mr-1"></i>ดำเนินการแล้ว (${sStu.length} คน)</span>`
                    : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800"><i class="fas fa-times mr-1"></i>ยังไม่ได้ดำเนินการ</span>'}
                </div>
                <p class="text-[11px] text-slate-600">
                  ${sStu.length > 0 
                    ? `ปฐมวัย: <strong>${stuEarly}</strong> คน • ประถม ป.1-3: <strong>${stuPrimary}</strong> คน • สมรรถนะ EF: <strong class="text-sky-700">${(sStu.reduce((a,b)=>a+b.scoreAvg,0)/sStu.length).toFixed(2)}</strong>`
                    : 'ยังไม่มีการประเมินสมรรถนะทักษะสมองนักเรียน'}
                </p>
              </div>
              ${sStu.length > 0 ? `
                <div class="text-[10px] text-slate-500 pt-2 border-t border-slate-200">
                  ประเมินล่าสุด: <strong>${sStu[0].studentName || sStu[0].recipientName || '-'}</strong> (${formatThaiDate(sStu[0].date)})
                </div>
              ` : ''}
            </div>

            <!-- 5. ผู้ปกครอง -->
            <div class="p-4 rounded-2xl border ${sPar.length >= 1 ? 'bg-emerald-50/40 border-emerald-300' : 'bg-rose-50/30 border-rose-200'} flex flex-col justify-between space-y-3">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <i class="fas fa-heart text-rose-600"></i> ชุดที่ 5 : ผู้ปกครอง (เกณฑ์ขั้นต่ำ: 1 คน)
                  </span>
                  ${sPar.length >= 1 
                    ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800"><i class="fas fa-check mr-1"></i>ผ่านเกณฑ์ (${sPar.length} คน)</span>`
                    : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800"><i class="fas fa-times mr-1"></i>ยังไม่ถึงเกณฑ์ (0 คน)</span>'}
                </div>
                <p class="text-[11px] text-slate-600">
                  ${sPar.length > 0 
                    ? `ปฐมวัย: <strong>${parEarly}</strong> คน • ประถม: <strong>${parPrimary}</strong> คน • เฉลี่ย: <strong class="text-rose-700">${(sPar.reduce((a,b)=>a+b.scoreAvg,0)/sPar.length).toFixed(2)}</strong>`
                    : 'ยังไม่มีผู้ปกครองตอบแบบประเมิน (เกณฑ์ขั้นต่ำ: 1 คนต่อโรงเรียน)'}
                </p>
              </div>
              ${sPar.length > 0 ? `
                <div class="text-[10px] text-slate-500 pt-2 border-t border-slate-200">
                  ตอบล่าสุด: <strong>${sPar[0].evaluator || '-'}</strong> (${formatThaiDate(sPar[0].date)})
                </div>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- 2. สถิติสมรรถนะทักษะสมอง EF จำแนกรายด้าน (9 ด้าน) เฉพาะของสถานศึกษา -->
        <div class="space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-100 gap-2">
            <div>
              <h3 class="text-base font-bold text-slate-800 flex items-center gap-2">
                <i class="fas fa-brain text-indigo-600"></i>
                <span>2. สถิติสมรรถนะทักษะสมอง EF จำแนกรายด้าน (9 ด้านมาตรฐาน)</span>
              </h3>
              <p class="text-xs text-slate-500">ผลการประเมินทักษะสมองส่วนหน้า Executive Functions เฉพาะสถานศึกษา ${school.name}</p>
            </div>
            <span class="text-xs font-bold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 w-fit">
              เกณฑ์คะแนนเต็ม 3.00
            </span>
          </div>

          <!-- 3 Pillar Summary Cards for this School -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200">
              <span class="text-[11px] font-bold text-blue-900 block">กลุ่มที่ 1 : ทักษะพื้นฐาน</span>
              <div class="text-xl font-bold text-blue-700 mt-1">${basicScore} <span class="text-[10px] font-normal text-slate-400">/ 3.00</span></div>
              <p class="text-[10px] text-slate-500 mt-0.5">ความจำใช้งาน, ยั้งคิดไตร่ตรอง, ยืดหยุ่นความคิด</p>
            </div>
            <div class="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-200">
              <span class="text-[11px] font-bold text-indigo-900 block">กลุ่มที่ 2 : ทักษะกำกับตนเอง</span>
              <div class="text-xl font-bold text-indigo-700 mt-1">${selfScore} <span class="text-[10px] font-normal text-slate-400">/ 3.00</span></div>
              <p class="text-[10px] text-slate-500 mt-0.5">จดจ่อใส่ใจ, ควบคุมอารมณ์, ติดตามประเมินตน</p>
            </div>
            <div class="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200">
              <span class="text-[11px] font-bold text-emerald-900 block">กลุ่มที่ 3 : ทักษะลงมือปฏิบัติ</span>
              <div class="text-xl font-bold text-emerald-700 mt-1">${practiceScore} <span class="text-[10px] font-normal text-slate-400">/ 3.00</span></div>
              <p class="text-[10px] text-slate-500 mt-0.5">ริเริ่มลงมือทำ, วางแผนจัดระบบ, มุ่งเป้าหมาย</p>
            </div>
          </div>

          <!-- 9 Domains Table for this School -->
          <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th class="p-2.5 text-center w-10">#</th>
                  <th class="p-2.5">ด้านทักษะสมอง (EF Domain)</th>
                  <th class="p-2.5 text-center w-20">ข้อมูล (ชุด)</th>
                  <th class="p-2.5 text-center w-24">คะแนน (x̄)</th>
                  <th class="p-2.5 text-center w-16">S.D.</th>
                  <th class="p-2.5 w-32">การเติบโต (%)</th>
                  <th class="p-2.5 text-center w-28">ระดับคุณภาพ</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${schoolDomainStats.map((d, idx) => `
                  <tr class="hover:bg-slate-50">
                    <td class="p-2.5 text-center font-bold text-slate-400">${idx + 1}</td>
                    <td class="p-2.5 font-medium text-slate-800">${d.name}</td>
                    <td class="p-2.5 text-center font-semibold text-slate-600">${d.count}</td>
                    <td class="p-2.5 text-center">
                      <strong class="text-sm ${d.avg !== '-' ? (Number(d.avg) >= 2.5 ? 'text-emerald-700' : Number(d.avg) >= 1.8 ? 'text-blue-700' : 'text-amber-700') : 'text-slate-400'}">${d.avg}</strong>
                    </td>
                    <td class="p-2.5 text-center font-mono text-slate-500">${d.sd}</td>
                    <td class="p-2.5">
                      <div class="flex items-center gap-1.5">
                        <div class="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div class="${d.barColor} h-1.5 rounded-full" style="width: ${d.pctNum}%"></div>
                        </div>
                        <span class="text-[10px] font-mono text-slate-500 shrink-0">${d.pct}</span>
                      </div>
                    </td>
                    <td class="p-2.5 text-center">
                      <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${d.qColor}">
                        ${d.quality}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 3. รายการประวัติการส่งข้อมูลของโรงเรียน (Submission Audit Log) -->
        <div class="space-y-3">
          <div class="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 class="text-base font-bold text-slate-800 flex items-center gap-2">
              <i class="fas fa-history text-blue-600"></i>
              <span>3. รายการประวัติการตอบแบบประเมินของโรงเรียน (${schoolSubs.length} รายการ)</span>
            </h3>
            <span class="text-xs text-slate-500">คลิก "ตรวจสอบคำตอบ" เพื่อดูรายข้อ</span>
          </div>

          <div class="space-y-2.5 max-h-60 overflow-y-auto">
            ${schoolSubs.length > 0 ? schoolSubs.map(s => `
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-100/80 transition">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-slate-800">${s.typeName}</span>
                    <span class="text-[10px] font-mono bg-slate-200 text-slate-600 px-2 py-0.5 rounded">${s.id}</span>
                    ${s.attachment ? `<span class="inline-flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold" title="${s.attachment.name}"><i class="fas fa-paperclip"></i> มีไฟล์แนบ</span>` : ''}
                  </div>
                  <p class="text-[11px] text-slate-500 mt-1">
                    ผู้ประเมิน: <strong>${s.evaluator || '-'}</strong>
                    ${s.recipientName || s.studentName ? ` • ผู้รับการประเมิน: <strong>${s.recipientName || s.studentName}</strong>` : ''}
                    • วันที่: <strong>${formatThaiDate(s.date)}</strong>
                  </p>
                </div>
                <div class="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  <div class="text-right">
                    <span class="text-sm font-bold text-blue-700">${(Number(s.scoreAvg) || 0).toFixed(2)}</span>
                    <span class="text-[10px] block text-slate-500">${s.qualityLevel}</span>
                  </div>
                  <div class="flex items-center gap-1 border-l border-slate-200 pl-2">
                    <button onclick="window.EF_APP.viewSubmissionDetail('${s.id}')" class="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs flex items-center gap-1 transition" title="ตรวจสอบคำตอบย้อนหลัง">
                      <i class="fas fa-search-plus"></i> ตรวจสอบ
                    </button>
                    <button onclick="window.EF_APP.deleteSubmission('${s.id}', '${school.id}')" class="p-1 rounded text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition" title="ลบรายการนี้ (กรณีบันทึกผิดพลาด)">
                      <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                  </div>
                </div>
              </div>
            `).join('') : '<p class="text-xs text-slate-400 py-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">ยังไม่มีข้อมูลการประเมินที่บันทึกสำหรับโรงเรียนนี้</p>'}
          </div>
        </div>

        <!-- Modal Footer Actions -->
        <div class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
          <div class="text-xs text-slate-500">
            ระบบประเมินทักษะสมอง EF 69 สพป.น่าน เขต 1
          </div>
          <div class="flex items-center gap-2">
            <button onclick="window.EF_APP.viewSchoolReport('${school.id}'); document.getElementById('school-progress-modal').remove();" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition">
              <i class="fas fa-file-invoice"></i>
              <span>ดูรายงานผลสถานศึกษาฉบับเต็ม</span>
            </button>
            <button onclick="document.getElementById('school-progress-modal').remove()" class="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition">
              ปิดหน้าต่าง
            </button>
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
  }

  // Settings Modal (GAS URL Configuration)
  function openSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm';
    modal.innerHTML = `
      <div class="academic-card p-6 md:p-8 max-w-lg w-full bg-white border border-slate-200 shadow-2xl">
        <div class="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
          <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
            <i class="fas fa-cog text-blue-600"></i>
            <span>ตั้งค่าการเชื่อมต่อ Google Apps Script</span>
          </h3>
          <button onclick="document.getElementById('settings-modal').remove()" class="text-slate-400 hover:text-slate-700">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <p class="text-xs text-slate-600 mb-4">
          เมื่อท่าน Deploy Google Apps Script (จากไฟล์ <code>Code.gs</code>) เป็น Web App ให้นำ <strong>Web App URL</strong> มาวางที่นี่เพื่อส่งข้อมูลลง Google Sheet ของโครงการโดยตรง
        </p>

        <div class="space-y-4">
          <div>
            <label class="block text-xs font-bold text-slate-700 mb-1.5">Google Apps Script Web App URL</label>
            <input type="url" id="gas-url-input" value="${state.googleScriptUrl}" placeholder="https://script.google.com/macros/s/.../exec"
              class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500">
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button onclick="document.getElementById('settings-modal').remove()" class="px-4 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-700">ยกเลิก</button>
            <button onclick="window.EF_APP.saveGasUrl()" class="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md">บันทึก URL</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function saveGasUrl() {
    const input = document.getElementById('gas-url-input');
    if (input) {
      state.googleScriptUrl = input.value.trim();
      localStorage.setItem('ef69_gas_url', state.googleScriptUrl);
      showToast('บันทึกการตั้งค่า Google Apps Script เรียบร้อยแล้ว', 'success');
      const modal = document.getElementById('settings-modal');
      if (modal) modal.remove();
    }
  }

  // =========================================================================
  // 6. ACADEMIC INFORMATION REPORT VIEW & OBEC FORM ASSISTANT
  // =========================================================================
  function getObecConfig() {
    const subs = state.submissions || [];

    // Filter teacher and supervisor evaluations
    const teacherSubs = subs.filter(s => s.type === 'teacher' || s.type === 'teacher_early' || s.type === 'teacher_primary' || s.type === 'supervisor');
    const teacherEarlyA1 = teacherSubs.filter(s => (s.teachingStage === 'early' || s.type === 'teacher_early') && (s.gradeLevel === 'a1' || (s.gradeLevelName && s.gradeLevelName.includes('1')))).length;
    const teacherEarlyA2 = teacherSubs.filter(s => (s.teachingStage === 'early' || s.type === 'teacher_early') && (s.gradeLevel === 'a2' || (s.gradeLevelName && s.gradeLevelName.includes('2')))).length;
    const teacherEarlyA3 = teacherSubs.filter(s => (s.teachingStage === 'early' || s.type === 'teacher_early') && (s.gradeLevel === 'a3' || (s.gradeLevelName && s.gradeLevelName.includes('3')))).length;
    const teacherEarlyMulti = teacherSubs.filter(s => (s.teachingStage === 'early' || s.type === 'teacher_early') && (s.gradeLevel === 'multi_early' || s.gradeLevel === 'multi' || (!['a1','a2','a3'].includes(s.gradeLevel) && (!s.gradeLevelName || !s.gradeLevelName.match(/[123]/))))).length;
    const teacherEarlyTotalDev = teacherEarlyA1 + teacherEarlyA2 + teacherEarlyA3 + teacherEarlyMulti;

    const teacherPrimaryP1 = teacherSubs.filter(s => (s.teachingStage === 'primary' || s.type === 'teacher_primary') && (s.gradeLevel === 'p1' || (s.gradeLevelName && s.gradeLevelName.includes('1')))).length;
    const teacherPrimaryP2 = teacherSubs.filter(s => (s.teachingStage === 'primary' || s.type === 'teacher_primary') && (s.gradeLevel === 'p2' || (s.gradeLevelName && s.gradeLevelName.includes('2')))).length;
    const teacherPrimaryP3 = teacherSubs.filter(s => (s.teachingStage === 'primary' || s.type === 'teacher_primary') && (s.gradeLevel === 'p3' || (s.gradeLevelName && s.gradeLevelName.includes('3')))).length;
    const teacherPrimaryMulti = teacherSubs.filter(s => (s.teachingStage === 'primary' || s.type === 'teacher_primary') && (s.gradeLevel === 'multi_primary' || s.gradeLevel === 'multi' || (!['p1','p2','p3'].includes(s.gradeLevel) && (!s.gradeLevelName || !s.gradeLevelName.match(/[123]/))))).length;
    const teacherPrimaryTotalDev = teacherPrimaryP1 + teacherPrimaryP2 + teacherPrimaryP3 + teacherPrimaryMulti;

    // Filter student evaluations
    const studentEarlySubs = subs.filter(s => s.type === 'student_early');
    const studentEarlyA1 = studentEarlySubs.filter(s => s.gradeLevel === 'a1').length;
    const studentEarlyA2 = studentEarlySubs.filter(s => s.gradeLevel === 'a2').length;
    const studentEarlyA3 = studentEarlySubs.filter(s => s.gradeLevel === 'a3').length;

    const studentPrimarySubs = subs.filter(s => s.type === 'student_primary');
    const studentPrimaryP1 = studentPrimarySubs.filter(s => s.gradeLevel === 'p1').length;
    const studentPrimaryP2 = studentPrimarySubs.filter(s => s.gradeLevel === 'p2').length;
    const studentPrimaryP3 = studentPrimarySubs.filter(s => s.gradeLevel === 'p3').length;

    const defaultData = {
      budgetAllocatedEarly: '0',
      budgetUsedEarly: '0',
      teachersEarlyTotal: '145',
      teachersEarlyA1: String(teacherEarlyA1),
      teachersEarlyA2: String(teacherEarlyA2),
      teachersEarlyA3: String(teacherEarlyA3),
      teachersEarlyMulti: String(teacherEarlyMulti),
      teachersEarlyDevTotal: String(teacherEarlyTotalDev),
      teachersEarlyNotDev: String(Math.max(0, 145 - teacherEarlyTotalDev)),
      studentsEarlyTotal: '2597',
      studentsEarlyA1: String(studentEarlyA1),
      studentsEarlyA2: String(studentEarlyA2),
      studentsEarlyA3: String(studentEarlyA3),
      studentsEarlyNotDev: String(Math.max(0, 2597 - (studentEarlyA1 + studentEarlyA2 + studentEarlyA3))),
      bestPracticeEarly: 'นวัตกรรมการจัดประสบการณ์ Active Learning 6 โอกาส และสภาพแวดล้อมเพื่อส่งเสริมทักษะสมอง EF ในเด็กปฐมวัย 145 โรงเรียน สพป.น่าน เขต 1',
      recEarly: 'ควรขับเคลื่อนกระบวนการ PLC ภายในสถานศึกษาอย่างต่อเนื่อง และส่งเสริมการจัดมุมประสบการณ์ Sensory Integration ร่วมกับผู้ปกครองเพื่อการดูแลเด็กแบบองค์รวม',

      budgetAllocatedPrimary: '0',
      budgetUsedPrimary: '0',
      teachersPrimaryTotal: '290',
      teachersPrimaryP1: String(teacherPrimaryP1),
      teachersPrimaryP2: String(teacherPrimaryP2),
      teachersPrimaryP3: String(teacherPrimaryP3),
      teachersPrimaryMulti: String(teacherPrimaryMulti),
      teachersPrimaryDevTotal: String(teacherPrimaryTotalDev),
      teachersPrimaryNotDev: String(Math.max(0, 290 - teacherPrimaryTotalDev)),
      studentsPrimaryTotal: '5346',
      studentsPrimaryP1: String(studentPrimaryP1),
      studentsPrimaryP2: String(studentPrimaryP2),
      studentsPrimaryP3: String(studentPrimaryP3),
      studentsPrimaryNotDev: String(Math.max(0, 5346 - (studentPrimaryP1 + studentPrimaryP2 + studentPrimaryP3))),
      bestPracticePrimary: 'รูปแบบการนิเทศแบบโค้ช (Coaching) เพื่อบูรณาการทักษะสมอง EF สู่แผนการจัดการเรียนรู้ Active Learning ชั้น ป.1-3 สพป.น่าน เขต 1',
      recPrimary: 'ควรขยายผลการประเมินทักษะสมอง EF ให้ครอบคลุมทุกระดับชั้น และสร้างเครือข่ายครูแกนนำ EF Coach ประจำกลุ่มโรงเรียนทั้ง 16 กลุ่มอย่างยั่งยืน',

      reporterName: 'นายพุฒิพงษ์ วงศ์นันท์',
      reporterPosition: 'ศึกษานิเทศก์',
      reporterPhone: '086-1161126'
    };

    try {
      const saved = localStorage.getItem('ef69_obec_config');
      return saved ? { ...defaultData, ...JSON.parse(saved) } : defaultData;
    } catch(e) {
      return defaultData;
    }
  }

  function saveObecConfig(key, value) {
    const cfg = getObecConfig();
    cfg[key] = value;
    localStorage.setItem('ef69_obec_config', JSON.stringify(cfg));
    showToast('บันทึกข้อมูลเรียบร้อยแล้ว', 'success');
  }

  function copyTextToClipboard(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(`คัดลอก "${label}" แล้ว`, 'success');
      }).catch(() => {
        fallbackCopy(text, label);
      });
    } else {
      fallbackCopy(text, label);
    }
  }

  function fallbackCopy(text, label) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast(`คัดลอก "${label}" แล้ว`, 'success');
  }

  function switchReportTab(tab) {
    state.reportTab = tab;
    renderAcademicReportView();
  }

  function switchObecLevel(level) {
    state.obecLevel = level;
    renderAcademicReportView();
  }

  function copyAllObecData(level) {
    const cfg = getObecConfig();
    let text = '';
    if (level === 'early') {
      text = `=== รายงาน สพฐ. ระดับการศึกษาปฐมวัย (สพป.น่าน เขต 1) ===\n` +
        `รอบเขตพื้นที่: สพป.น่าน เขต 1\n` +
        `งบประมาณที่ได้รับจัดสรรจาก สพฐ. (บาท): ${cfg.budgetAllocatedEarly}\n` +
        `งบประมาณที่ใช้ในการพัฒนา (บาท): ${cfg.budgetUsedEarly}\n` +
        `จำนวนครูปฐมวัยทั้งหมด (คน): ${cfg.teachersEarlyTotal}\n` +
        `จำนวนครูปฐมวัยที่ได้รับการพัฒนา ระดับชั้นอนุบาล 1 (คน): ${cfg.teachersEarlyA1}\n` +
        `จำนวนครูปฐมวัยที่ได้รับการพัฒนา ระดับชั้นอนุบาล 2 (คน): ${cfg.teachersEarlyA2}\n` +
        `จำนวนครูปฐมวัยที่ได้รับการพัฒนา ระดับชั้นอนุบาล 3 (คน): ${cfg.teachersEarlyA3}\n` +
        `จำนวนครูปฐมวัยที่ได้รับการพัฒนา จัดสอนมากกว่า 1 ชั้น (คน): ${cfg.teachersEarlyMulti}\n` +
        `รวมจำนวนครูปฐมวัยที่ได้รับการพัฒนาทั้งหมด (คน): ${cfg.teachersEarlyDevTotal}\n` +
        `จำนวนครูปฐมวัยที่ไม่ได้รับการพัฒนา (คน): ${cfg.teachersEarlyNotDev}\n` +
        `จำนวนนักเรียนปฐมวัยทั้งหมด (คน) [ข้อมูล 10 มิ.ย. 2569]: ${cfg.studentsEarlyTotal}\n` +
        `จำนวนนักเรียนที่ได้รับการพัฒนาในระดับอนุบาล 1 (คน): ${cfg.studentsEarlyA1}\n` +
        `จำนวนนักเรียนที่ได้รับการพัฒนาในระดับอนุบาล 2 (คน): ${cfg.studentsEarlyA2}\n` +
        `จำนวนนักเรียนที่ได้รับการพัฒนาในระดับอนุบาล 3 (คน): ${cfg.studentsEarlyA3}\n` +
        `จำนวนนักเรียนที่ไม่ได้รับการพัฒนา (คน): ${cfg.studentsEarlyNotDev}\n` +
        `ผลงาน/นวัตกรรมที่สามารถเป็นแบบอย่างได้: ${cfg.bestPracticeEarly}\n` +
        `ข้อเสนอแนะในการพัฒนา: ${cfg.recEarly}\n` +
        `ชื่อ - นามสกุล (ผู้รายงาน): ${cfg.reporterName}\n` +
        `ตำแหน่ง: ${cfg.reporterPosition}\n` +
        `เบอร์โทรติดต่อ: ${cfg.reporterPhone}\n`;
    } else {
      text = `=== รายงาน สพฐ. ระดับประถมศึกษา ป.1 - 3 (สพป.น่าน เขต 1) ===\n` +
        `รอบเขตพื้นที่: สพป.น่าน เขต 1\n` +
        `งบประมาณที่ได้รับจัดสรรจาก สพฐ. (บาท): ${cfg.budgetAllocatedPrimary}\n` +
        `งบประมาณที่ใช้ในการพัฒนา (บาท): ${cfg.budgetUsedPrimary}\n` +
        `จำนวนครูชั้นประถมศึกษาปีที่ 1 - 3 ทั้งหมด (คน): ${cfg.teachersPrimaryTotal}\n` +
        `จำนวนครูที่ได้รับการพัฒนา ระดับชั้นประถมศึกษาปีที่ 1 (คน): ${cfg.teachersPrimaryP1}\n` +
        `จำนวนครูที่ได้รับการพัฒนา ระดับชั้นประถมศึกษาปีที่ 2 (คน): ${cfg.teachersPrimaryP2}\n` +
        `จำนวนครูที่ได้รับการพัฒนา ระดับชั้นประถมศึกษาปีที่ 3 (คน): ${cfg.teachersPrimaryP3}\n` +
        `จำนวนครูที่ได้รับการพัฒนา จัดสอนมากกว่า 1 ชั้น (คน): ${cfg.teachersPrimaryMulti}\n` +
        `รวมจำนวนครูชั้นประถมศึกษาปีที่ 1 - 3 ที่ได้รับการพัฒนาทั้งหมด (คน): ${cfg.teachersPrimaryDevTotal}\n` +
        `จำนวนครูชั้นประถมศึกษาปีที่ 1 - 3 ที่ไม่ได้รับการพัฒนา (คน): ${cfg.teachersPrimaryNotDev}\n` +
        `จำนวนนักเรียน ชั้นประถมศึกษาปีที่ 1 - 3 ทั้งหมด (คน) [ข้อมูล 10 มิ.ย. 2569]: ${cfg.studentsPrimaryTotal}\n` +
        `จำนวนนักเรียนที่ได้รับการพัฒนาในระดับ ชั้นประถมศึกษาปีที่ 1 (คน): ${cfg.studentsPrimaryP1}\n` +
        `จำนวนนักเรียนที่ได้รับการพัฒนาในระดับ ชั้นประถมศึกษาปีที่ 2 (คน): ${cfg.studentsPrimaryP2}\n` +
        `จำนวนนักเรียนที่ได้รับการพัฒนาในระดับ ชั้นประถมศึกษาปีที่ 3 (คน): ${cfg.studentsPrimaryP3}\n` +
        `จำนวนนักเรียน ชั้นประถมศึกษาปีที่ 1-3 ที่ไม่ได้รับการพัฒนา (คน): ${cfg.studentsPrimaryNotDev}\n` +
        `ผลงาน/นวัตกรรมที่สามารถเป็นแบบอย่างได้: ${cfg.bestPracticePrimary}\n` +
        `ข้อเสนอแนะในการพัฒนา: ${cfg.recPrimary}\n` +
        `ชื่อ - นามสกุล (ผู้รายงาน): ${cfg.reporterName}\n` +
        `ตำแหน่ง: ${cfg.reporterPosition}\n` +
        `เบอร์โทรติดต่อ: ${cfg.reporterPhone}\n`;
    }
    copyTextToClipboard(text, 'ข้อมูลสรุปสำหรับรายงาน สพฐ. ทั้งหมด');
  }

  function renderAcademicReportView() {
    const container = document.getElementById('view-academic-report');
    if (!container) return;

    if (!state.reportTab) {
      state.reportTab = state.adminAuth ? 'obec' : 'academic';
    }
    if (!state.obecLevel) state.obecLevel = 'early';

    const totalSchools = (window.NAN1_SCHOOLS || []).length;
    const subs = state.submissions || [];
    const uniqueSchools = new Set(subs.map(s => s.schoolId)).size;
    const isObec = state.reportTab === 'obec';
    const isEarly = state.obecLevel === 'early';
    const cfg = getObecConfig();

    // 9 EF Domains Dynamic Computation from live submissions
    const domainDef = [
      { key: 'wm', name: '1. ความจำที่นำมาใช้งาน (Working Memory)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'ic', name: '2. การยั้งคิดไตร่ตรอง (Inhibitory Control)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'sh', name: '3. ความยืดหยุ่นทางความคิด (Shift)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'fo', name: '4. การจดจ่อใส่ใจ (Focus / Attention)', group: 'กลุ่มที่ 2 : ทักษะการกำกับตนเอง (Self-Regulation Skills)', groupKey: 'self' },
      { key: 'ec', name: '5. การควบคุมอารมณ์ (Emotional Control)', group: 'กลุ่มที่ 2 : ทักษะการกำกับตนเอง (Self-Regulation Skills)', groupKey: 'self' },
      { key: 'sm', name: '6. การติดตามประเมินตนเอง (Self-Monitoring)', group: 'กลุ่มที่ 2 : ทักษะการกำกับตนเอง (Self-Regulation Skills)', groupKey: 'self' },
      { key: 'in', name: '7. การริเริ่มและลงมือทำ (Initiating)', group: 'กลุ่มที่ 3 : ทักษะการลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' },
      { key: 'po', name: '8. การวางแผนและการจัดระบบ (Planning)', group: 'กลุ่มที่ 3 : ทักษะการลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' },
      { key: 'gp', name: '9. การมุ่งเป้าหมาย (Goal-Directed)', group: 'กลุ่มที่ 3 : ทักษะการลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' }
    ];

    const domainStats = domainDef.map(d => {
      let scores = [];
      if (subs.length > 0) {
        subs.forEach(s => {
          if (s.domainScores && typeof s.domainScores[d.key] === 'number') {
            scores.push(s.domainScores[d.key]);
          } else if (typeof s.scoreAvg === 'number') {
            scores.push(s.scoreAvg);
          }
        });
      }

      const count = scores.length;
      const avg = count > 0 ? scores.reduce((a, b) => a + b, 0) / count : 0;
      let sd = 0;
      if (count > 1) {
        const variance = scores.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / (count - 1);
        sd = Math.sqrt(variance);
      }
      const pct = (avg / 3.0) * 100;
      let quality = count > 0 ? (avg >= 2.5 ? 'ดีมาก' : avg >= 1.8 ? 'พอใช้' : 'ควรหนุนเสริม') : 'รอการประเมิน';
      let qColor = count > 0 ? (avg >= 2.5 ? 'text-emerald-700' : avg >= 1.8 ? 'text-blue-700' : 'text-amber-700') : 'text-slate-400';

      return {
        ...d,
        count,
        avg: avg.toFixed(2),
        sd: sd.toFixed(2),
        pct: pct.toFixed(1) + '%',
        quality,
        qColor,
        numAvg: avg
      };
    });

    const basicAvg = domainStats.filter(d => d.groupKey === 'basic');
    const basicScore = (basicAvg.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2);
    
    const selfAvg = domainStats.filter(d => d.groupKey === 'self');
    const selfScore = (selfAvg.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2);
    
    const practiceAvg = domainStats.filter(d => d.groupKey === 'practice');
    const practiceScore = (practiceAvg.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2);

    const totalDistrictAvg = subs.length > 0 ? (subs.reduce((a, b) => a + (Number(b.scoreAvg) || 0), 0) / subs.length).toFixed(2) : '0.00';
    const percentSubmitted = totalSchools > 0 ? Math.round((uniqueSchools / totalSchools) * 100) : 0;

    // Dynamic Strengths & Priority Areas
    const sortedDomains = [...domainStats].sort((a, b) => b.numAvg - a.numAvg);
    const topStrengths = sortedDomains.slice(0, 3);
    const priorityAreas = [...domainStats].sort((a, b) => a.numAvg - b.numAvg).slice(0, 3);

    container.innerHTML = `
      <!-- Report Header Bar & Tab Switcher -->
      <div class="no-print mb-8">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 class="text-2xl md:text-3xl font-bold text-slate-800">ศูนย์รายงานสารสนเทศ & สรุปข้อมูลรายงาน สพฐ.</h2>
            <p class="text-xs text-slate-500">ระบบประมวลผลข้อมูล 145 โรงเรียน เพื่อการบริหารจัดการและการส่งรายงานระดับชาติ</p>
          </div>

          <div class="flex items-center gap-3">
            <button onclick="window.print()" class="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-2 shadow-md transition whitespace-nowrap">
              <i class="fas fa-print"></i>
              <span>พิมพ์รายงาน / บันทึก PDF</span>
            </button>
            <button onclick="window.EF_APP.exportToExcel()" class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 shadow-md transition whitespace-nowrap">
              <i class="fas fa-file-excel"></i>
              <span>ส่งออก Excel</span>
            </button>
          </div>
        </div>

        <!-- Mode Navigation Tabs -->
        <div class="flex border-b border-slate-200 gap-3 font-heading">
          <button onclick="window.EF_APP.switchReportTab('obec')" class="pb-3 px-4 font-bold text-sm border-b-2 flex items-center gap-2 transition ${isObec ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}">
            <i class="fas ${state.adminAuth ? 'fa-file-signature' : 'fa-lock text-amber-500'}"></i>
            <span>ศูนย์เตรียมข้อมูลรายงาน สพฐ. (OBEC Form Assistant)</span>
            ${!state.adminAuth ? '<span class="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">เฉพาะ Admin</span>' : ''}
          </button>
          <button onclick="window.EF_APP.switchReportTab('academic')" class="pb-3 px-4 font-bold text-sm border-b-2 flex items-center gap-2 transition ${!isObec ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}">
            <i class="fas fa-book-open"></i>
            <span>รายงานสารสนเทศเชิงวิชาการ (Executive Report)</span>
          </button>
        </div>
      </div>

      ${isObec ? (
        !state.adminAuth ? `
        <!-- Locked for Non-Admin -->
        <div class="max-w-md mx-auto my-12 academic-card p-8 bg-white border border-slate-200 text-center shadow-xl">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 text-white flex items-center justify-center text-2xl font-bold mx-auto mb-4 shadow-lg shadow-amber-500/20">
            <i class="fas fa-lock"></i>
          </div>
          <h3 class="text-xl font-bold text-slate-800 mb-1">พื้นที่สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin)</h3>
          <p class="text-xs text-slate-500 mb-6">ชุดเตรียมข้อมูลกรอกฟอร์ม สพฐ. (OBEC Form Assistant) สงวนสิทธิ์สำหรับ นายพุฒิพงษ์ วงศ์นันท์ ศึกษานิเทศก์ (โทร. 086-1161126) และคณะทำงานโครงการ สพป.น่าน เขต 1 เท่านั้น</p>

          <form id="obec-admin-login-form" onsubmit="event.preventDefault(); window.EF_APP.handleAdminLogin(event); return false;" class="space-y-4 text-left">
            <div>
              <label class="block text-xs font-bold text-slate-700 mb-1.5">รหัสผ่านควบคุมระบบ (Passcode)</label>
              <input type="password" id="admin-passcode-input" placeholder="กรอกรหัสผ่านควบคุมระบบ" autofocus
                onkeydown="if(event.key==='Enter'){event.preventDefault(); window.EF_APP.handleAdminLogin(event);}"
                class="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
            </div>
            <button type="button" onclick="window.EF_APP.handleAdminLogin(event)" class="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2">
              <i class="fas fa-key"></i>
              <span>ยืนยันรหัสผ่านเพื่อเข้าใช้งาน</span>
            </button>
            <button type="button" onclick="window.EF_APP.switchReportTab('academic')" class="w-full py-2.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold text-xs transition">
              <span>ไปที่หน้ารายงานสารสนเทศเชิงวิชาการ</span>
            </button>
          </form>
        </div>
        ` : `
        <!-- ========================================================================= -->
        <!-- OBEC FORM ASSISTANT (ตัวช่วยกรอก Google Form สพฐ.) -->
        <!-- ========================================================================= -->
        <div class="max-w-5xl mx-auto space-y-6">
          
          <!-- Banner & Level Switcher -->
          <div class="p-6 rounded-2xl bg-gradient-to-r from-blue-900 to-indigo-900 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <span class="px-3 py-1 rounded-full text-xs font-bold bg-amber-400 text-slate-900 uppercase">
                <i class="fas fa-magic mr-1"></i> OBEC Form Assistant
              </span>
              <h3 class="text-xl md:text-2xl font-bold mt-2">ชุดข้อมูลสรุปสำหรับกรอกแบบฟอร์ม Google Form ของ สพฐ.</h3>
              <p class="text-xs text-blue-200 mt-1">
                คลิกปุ่ม <strong class="text-amber-300">"คัดลอก (Copy)"</strong> เพื่อนำข้อความไปวางลงใน Google Form ของ สพฐ. ได้ทันทีทีละช่อง
              </p>
            </div>

            <!-- Level Selector -->
            <div class="flex bg-white/10 p-1.5 rounded-xl border border-white/20 shrink-0">
              <button onclick="window.EF_APP.switchObecLevel('early')" class="px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${isEarly ? 'bg-amber-400 text-slate-950 shadow-md' : 'text-white hover:bg-white/10'}">
                <i class="fas fa-baby"></i>
                <span>1. ระดับปฐมวัย (อ.1 - อ.3)</span>
              </button>
              <button onclick="window.EF_APP.switchObecLevel('primary')" class="px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 ${!isEarly ? 'bg-amber-400 text-slate-950 shadow-md' : 'text-white hover:bg-white/10'}">
                <i class="fas fa-child"></i>
                <span>2. ระดับประถมศึกษา (ป.1 - ป.3)</span>
              </button>
            </div>
          </div>

          <!-- Quick Action Bar -->
          <div class="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div class="text-xs text-slate-600">
              <i class="fas fa-info-circle text-blue-600 mr-1"></i>
              กำลังแสดงข้อมูลสำหรับ: <strong class="text-slate-900">${isEarly ? 'แบบฟอร์มระดับปฐมวัย (อ.1 - อ.3)' : 'แบบฟอร์มระดับประถมศึกษา (ป.1 - ป.3)'}</strong>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="window.EF_APP.copyAllObecData('${state.obecLevel || 'early'}')" class="px-3.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold border border-emerald-300 flex items-center gap-1.5 transition">
                <i class="fas fa-copy"></i>
                <span>คัดลอกข้อมูลสรุปทั้งหมด</span>
              </button>
              <button onclick="window.print()" class="px-3.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold border border-blue-300 flex items-center gap-1.5 transition">
                <i class="fas fa-file-pdf"></i>
                <span>พิมพ์/บันทึก PDF รายงานแนบ สพฐ.</span>
              </button>
            </div>
          </div>

          <!-- Question Cards Container -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

            <!-- Card 1: เขตพื้นที่ -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-blue-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 1 • รอบเขตพื้นที่</span>
                <p class="text-sm font-semibold text-slate-800 mt-1">สพป.น่าน เขต 1</p>
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('สพป.น่าน เขต 1', 'รอบเขตพื้นที่')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 2: งบประมาณที่ได้รับจัดสรร -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-blue-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 2 • งบประมาณที่ได้รับจัดสรรจาก สพฐ. (บาท)</span>
                <input type="text" value="${isEarly ? cfg.budgetAllocatedEarly : cfg.budgetAllocatedPrimary}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'budgetAllocatedEarly' : 'budgetAllocatedPrimary'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.budgetAllocatedEarly : cfg.budgetAllocatedPrimary}', 'งบประมาณที่ได้รับจัดสรร')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 3: งบประมาณที่ใช้ในการพัฒนา -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-blue-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 3 • งบประมาณที่ใช้ในการพัฒนา (บาท)</span>
                <input type="text" value="${isEarly ? cfg.budgetUsedEarly : cfg.budgetUsedPrimary}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'budgetUsedEarly' : 'budgetUsedPrimary'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.budgetUsedEarly : cfg.budgetUsedPrimary}', 'งบประมาณที่ใช้ในการพัฒนา')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 4: จำนวนครูทั้งหมด -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-emerald-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 4 • จำนวนครู${isEarly ? 'ปฐมวัย' : 'ชั้นประถมศึกษาปีที่ 1 - 3'}ทั้งหมด (คน)</span>
                <input type="number" value="${isEarly ? cfg.teachersEarlyTotal : cfg.teachersPrimaryTotal}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'teachersEarlyTotal' : 'teachersPrimaryTotal'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.teachersEarlyTotal : cfg.teachersPrimaryTotal}', 'จำนวนครูทั้งหมด')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 5: ครูได้รับการพัฒนา ชั้นที่ 1 (อ.1 / ป.1) -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-emerald-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 5 • ครูได้รับการพัฒนา ระดับชั้น${isEarly ? 'อนุบาล 1' : 'ประถมศึกษาปีที่ 1'} (คน)</span>
                <input type="number" value="${isEarly ? cfg.teachersEarlyA1 : cfg.teachersPrimaryP1}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'teachersEarlyA1' : 'teachersPrimaryP1'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.teachersEarlyA1 : cfg.teachersPrimaryP1}', 'ครูได้รับการพัฒนา ชั้นที่ 1')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 6: ครูได้รับการพัฒนา ชั้นที่ 2 (อ.2 / ป.2) -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-emerald-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 6 • ครูได้รับการพัฒนา ระดับชั้น${isEarly ? 'อนุบาล 2' : 'ประถมศึกษาปีที่ 2'} (คน)</span>
                <input type="number" value="${isEarly ? cfg.teachersEarlyA2 : cfg.teachersPrimaryP2}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'teachersEarlyA2' : 'teachersPrimaryP2'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.teachersEarlyA2 : cfg.teachersPrimaryP2}', 'ครูได้รับการพัฒนา ชั้นที่ 2')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 7: ครูได้รับการพัฒนา ชั้นที่ 3 (อ.3 / ป.3) -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-emerald-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 7 • ครูได้รับการพัฒนา ระดับชั้น${isEarly ? 'อนุบาล 3' : 'ประถมศึกษาปีที่ 3'} (คน)</span>
                <input type="number" value="${isEarly ? cfg.teachersEarlyA3 : cfg.teachersPrimaryP3}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'teachersEarlyA3' : 'teachersPrimaryP3'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.teachersEarlyA3 : cfg.teachersPrimaryP3}', 'ครูได้รับการพัฒนา ชั้นที่ 3')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 8: ครูสอนมากกว่า 1 ชั้น -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-emerald-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 8 • ครูได้รับการพัฒนา จัดสอนมากกว่า 1 ชั้น (คน)</span>
                <input type="number" value="${isEarly ? cfg.teachersEarlyMulti : cfg.teachersPrimaryMulti}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'teachersEarlyMulti' : 'teachersPrimaryMulti'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.teachersEarlyMulti : cfg.teachersPrimaryMulti}', 'ครูสอนมากกว่า 1 ชั้น')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 9: รวมครูที่ได้รับการพัฒนาทั้งหมด -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-emerald-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 9 • รวมจำนวนครูที่ได้รับการพัฒนาทั้งหมด (คน)</span>
                <input type="number" value="${isEarly ? cfg.teachersEarlyDevTotal : cfg.teachersPrimaryDevTotal}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'teachersEarlyDevTotal' : 'teachersPrimaryDevTotal'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.teachersEarlyDevTotal : cfg.teachersPrimaryDevTotal}', 'รวมครูที่ได้รับการพัฒนาทั้งหมด')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 10: ครูที่ไม่ได้รับการพัฒนา -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-emerald-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 10 • จำนวนครูที่ไม่ได้รับการพัฒนา (คน)</span>
                <input type="number" value="${isEarly ? cfg.teachersEarlyNotDev : cfg.teachersPrimaryNotDev}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'teachersEarlyNotDev' : 'teachersPrimaryNotDev'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.teachersEarlyNotDev : cfg.teachersPrimaryNotDev}', 'ครูที่ไม่ได้รับการพัฒนา')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
              </div>
            </div>

            <!-- Card 14: นักเรียนได้รับการพัฒนา ชั้นที่ 3 (อ.3 / ป.3) -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-amber-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 14 • นักเรียนได้รับการพัฒนา ระดับชั้น${isEarly ? 'อนุบาล 3' : 'ประถมศึกษาปีที่ 3'} (คน)</span>
                <input type="number" value="${isEarly ? cfg.studentsEarlyA3 : cfg.studentsPrimaryP3}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'studentsEarlyA3' : 'studentsPrimaryP3'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.studentsEarlyA3 : cfg.studentsPrimaryP3}', 'นักเรียนได้รับการพัฒนา ชั้นที่ 3')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 15: นักเรียนที่ไม่ได้รับการพัฒนา -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-amber-600">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 15 • นักเรียนที่ไม่ได้รับการพัฒนา (คน)</span>
                <input type="number" value="${isEarly ? cfg.studentsEarlyNotDev : cfg.studentsPrimaryNotDev}" 
                  onchange="window.EF_APP.saveObecConfig('${isEarly ? 'studentsEarlyNotDev' : 'studentsPrimaryNotDev'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.studentsEarlyNotDev : cfg.studentsPrimaryNotDev}', 'นักเรียนที่ไม่ได้รับการพัฒนา')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 16: รายงานสรุปผล PDF แนบส่ง -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-purple-600 bg-purple-50/20 md:col-span-2">
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold text-slate-500">ข้อ 16 • รายงานการกำกับ ติดตาม และสรุปผลการดำเนินงาน (พร้อมภาพประกอบเป็นไฟล์ PDF)</span>
                  <span class="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-bold">ช่องแนบไฟล์ PDF</span>
                </div>
                <p class="text-xs text-slate-600 mt-2">
                  สพฐ. กำหนดให้อัปโหลดไฟล์ PDF รายงานสรุปผล ท่านสามารถกดปุ่มด้านล่างเพื่อสั่งพิมพ์หรือบันทึกหน้าเอกสารทางการของระบบเป็นไฟล์ PDF แล้วนำไปอัปโหลดได้ทันที
                </p>
              </div>
              <div class="mt-4 flex gap-2 justify-end">
                <button onclick="window.print()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold shadow-md transition flex items-center gap-1.5">
                  <i class="fas fa-print"></i>
                  <span>พิมพ์ / บันทึก PDF รายงานสรุปผลฉบับสมบูรณ์</span>
                </button>
              </div>
            </div>

            <!-- Card 17: ผลงาน/นวัตกรรมที่สามารถเป็นแบบอย่างได้ -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-blue-600 md:col-span-2">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 17 • ผลงาน/นวัตกรรมที่สามารถเป็นแบบอย่างได้ (ระบุชื่อผลงานตามรายงาน)</span>
                <textarea rows="2" onchange="window.EF_APP.saveObecConfig('${isEarly ? 'bestPracticeEarly' : 'bestPracticePrimary'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm text-slate-800 focus:bg-white leading-relaxed">${isEarly ? cfg.bestPracticeEarly : cfg.bestPracticePrimary}</textarea>
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.bestPracticeEarly.replace(/'/g, "\\'") : cfg.bestPracticePrimary.replace(/'/g, "\\'")}', 'ผลงาน/นวัตกรรมที่สามารถเป็นแบบอย่างได้')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 18: ข้อเสนอแนะในการพัฒนา -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-blue-600 md:col-span-2">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 18 • ข้อเสนอแนะในการพัฒนา</span>
                <textarea rows="2" onchange="window.EF_APP.saveObecConfig('${isEarly ? 'recEarly' : 'recPrimary'}', this.value)"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm text-slate-800 focus:bg-white leading-relaxed">${isEarly ? cfg.recEarly : cfg.recPrimary}</textarea>
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${isEarly ? cfg.recEarly.replace(/'/g, "\\'") : cfg.recPrimary.replace(/'/g, "\\'")}', 'ข้อเสนอแนะในการพัฒนา')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 19: ชื่อ - นามสกุล ผู้รายงาน -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-slate-700">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 19 • ชื่อ - นามสกุล (ผู้รายงาน)</span>
                <p class="text-sm font-bold text-slate-900 mt-1">${cfg.reporterName}</p>
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${cfg.reporterName}', 'ชื่อ-นามสกุลผู้รายงาน')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 20: ตำแหน่ง -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-slate-700">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 20 • ตำแหน่ง</span>
                <p class="text-sm font-bold text-slate-900 mt-1">${cfg.reporterPosition}</p>
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${cfg.reporterPosition}', 'ตำแหน่ง')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

            <!-- Card 21: เบอร์โทรติดต่อ -->
            <div class="academic-card p-4 flex flex-col justify-between border-l-4 border-l-slate-700 md:col-span-2">
              <div>
                <span class="text-[11px] font-bold text-slate-500">ข้อ 21 • เบอร์โทรติดต่อ</span>
                <input type="text" value="${cfg.reporterPhone}" 
                  onchange="window.EF_APP.saveObecConfig('reporterPhone', this.value)" placeholder="ระบุเบอร์โทรติดต่อ เช่น 081-xxxxxxx"
                  class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:bg-white">
              </div>
              <div class="mt-3 text-right">
                <button onclick="window.EF_APP.copyTextToClipboard('${cfg.reporterPhone}', 'เบอร์โทรติดต่อ')" class="px-3 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-md text-xs font-bold text-slate-700 transition">
                  <i class="fas fa-copy mr-1"></i> คัดลอก
                </button>
              </div>
            </div>

          </div>

        </div>
        `
      ) : `
        <!-- ========================================================================= -->
        <!-- ACADEMIC REPORT VIEW (รายงานเชิงวิชาการฉบับเต็ม) -->
        <!-- ========================================================================= -->
        <div class="academic-card p-8 md:p-12 bg-white border border-slate-300 shadow-xl max-w-5xl mx-auto printable-doc">
          <!-- Official Header -->
          <div class="text-center pb-6 border-b-2 border-slate-800 mb-8">
            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 text-amber-400 text-2xl font-bold mb-3 shadow-md">
              <i class="fas fa-graduation-cap"></i>
            </div>
            <h1 class="text-2xl md:text-3xl font-bold text-slate-900">รายงานสรุปผลการกำกับ ติดตาม และประเมินผล</h1>
            <h2 class="text-lg md:text-xl font-bold text-slate-800 mt-1">โครงการสร้างภูมิคุ้มกันและพัฒนาทักษะสมอง (Executive Functions : EF)</h2>
            <p class="text-sm text-slate-600 mt-2">
              สำนักงานเขตพื้นที่การศึกษาประถมศึกษาน่าน เขต 1 ประจำปีการศึกษา 2569
            </p>
            <p class="text-xs text-slate-500 mt-1 font-mono">
              ผู้รับผิดชอบโครงการ: นายพุฒิพงษ์ วงศ์นันท์ ศึกษานิเทศก์ (โทร. 086-1161126)
            </p>
          </div>

          <!-- Section 1: Executive Summary -->
          <div class="mb-8">
            <h3 class="text-base font-bold text-slate-900 uppercase tracking-wide border-l-4 border-blue-600 pl-3 mb-3">
              1. สรุปสาระสำคัญเชิงบริหาร (Executive Summary)
            </h3>
            <p class="text-sm text-slate-700 text-justify leading-relaxed">
              สำนักงานเขตพื้นที่การศึกษาประถมศึกษาน่าน เขต 1 ได้ดำเนินโครงการสร้างภูมิคุ้มกันและส่งเสริมทักษะสมอง (EF) ในสถานศึกษาทั้ง 145 แห่ง ครอบคลุม 16 กลุ่มโรงเรียน โดยใช้ชุดเครื่องมือประเมินมาตรฐาน 5 ชุด สำหรับศึกษานิเทศก์ สถานศึกษา ครูผู้สอน นักเรียน และผู้ปกครอง จากการประมวลผลข้อมูลสารสนเทศ พบว่าสถานศึกษามีความก้าวหน้าในการขับเคลื่อนนโยบายสู่การปฏิบัติ มีการจัดการเรียนรู้เชิงรุก (Active Learning) สร้าง 6 โอกาสสำคัญ และการใช้วินัยเชิงบวกอย่างเป็นรูปธรรม โดยมีโรงเรียนเข้าร่วมการประเมินแล้วคิดเป็น <strong>${percentSubmitted}% (${uniqueSchools}/${totalSchools} โรงเรียน)</strong> และมีคะแนนเฉลี่ยสมรรถนะทักษะสมอง EF ภาพรวมอยู่ที่ <strong>${totalDistrictAvg} / 3.00</strong> ${subs.length > 0 ? `(${Number(totalDistrictAvg) >= 2.5 ? 'ระดับดีมาก / ยั่งยืน' : Number(totalDistrictAvg) >= 1.8 ? 'ระดับกำลังเติบโตและพัฒนา' : 'ระดับเริ่มต้นของการหนุนเสริม'})` : '(รอการบันทึกข้อมูลการประเมินจริง)'}
            </p>
          </div>

          <!-- Section 2: Table of 9 EF Domains -->
          <div class="mb-8">
            <h3 class="text-base font-bold text-slate-900 uppercase tracking-wide border-l-4 border-blue-600 pl-3 mb-3">
              2. ผลการประเมินสมรรถนะทักษะสมอง EF จำแนกตาม 9 ด้าน
            </h3>
            <div class="overflow-x-auto">
              <table class="w-full text-xs border border-slate-300">
                <thead class="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                  <tr>
                    <th class="p-2.5 border-r border-slate-300">กลุ่มทักษะ</th>
                    <th class="p-2.5 border-r border-slate-300">ด้านทักษะสมอง EF</th>
                    <th class="p-2.5 text-center border-r border-slate-300">คะแนนเฉลี่ย (x̄)</th>
                    <th class="p-2.5 text-center border-r border-slate-300">ส่วนเบี่ยงเบน (S.D.)</th>
                    <th class="p-2.5 text-center border-r border-slate-300">ร้อยละ (%)</th>
                    <th class="p-2.5 text-center">ระดับคุณภาพ</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 text-slate-700">
                  <tr class="bg-slate-50 font-semibold"><td colspan="6" class="p-2 text-blue-900">กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills) — เฉลี่ย ${basicScore}</td></tr>
                  ${domainStats.filter(d => d.groupKey === 'basic').map(d => `
                    <tr>
                      <td class="p-2.5 border-r border-slate-200">พื้นฐาน</td>
                      <td class="p-2.5 border-r border-slate-200">${d.name}</td>
                      <td class="p-2.5 text-center font-bold border-r border-slate-200">${d.avg}</td>
                      <td class="p-2.5 text-center border-r border-slate-200">${d.sd}</td>
                      <td class="p-2.5 text-center border-r border-slate-200">${d.pct}</td>
                      <td class="p-2.5 text-center font-semibold ${d.qColor}">${d.quality}</td>
                    </tr>
                  `).join('')}

                  <tr class="bg-slate-50 font-semibold"><td colspan="6" class="p-2 text-blue-900">กลุ่มที่ 2 : ทักษะการกำกับตนเอง (Self-Regulation Skills) — เฉลี่ย ${selfScore}</td></tr>
                  ${domainStats.filter(d => d.groupKey === 'self').map(d => `
                    <tr>
                      <td class="p-2.5 border-r border-slate-200">กำกับตนเอง</td>
                      <td class="p-2.5 border-r border-slate-200">${d.name}</td>
                      <td class="p-2.5 text-center font-bold border-r border-slate-200">${d.avg}</td>
                      <td class="p-2.5 text-center border-r border-slate-200">${d.sd}</td>
                      <td class="p-2.5 text-center border-r border-slate-200">${d.pct}</td>
                      <td class="p-2.5 text-center font-semibold ${d.qColor}">${d.quality}</td>
                    </tr>
                  `).join('')}

                  <tr class="bg-slate-50 font-semibold"><td colspan="6" class="p-2 text-blue-900">กลุ่มที่ 3 : ทักษะการลงมือปฏิบัติ (Practice Skills) — เฉลี่ย ${practiceScore}</td></tr>
                  ${domainStats.filter(d => d.groupKey === 'practice').map(d => `
                    <tr>
                      <td class="p-2.5 border-r border-slate-200">ลงมือปฏิบัติ</td>
                      <td class="p-2.5 border-r border-slate-200">${d.name}</td>
                      <td class="p-2.5 text-center font-bold border-r border-slate-200">${d.avg}</td>
                      <td class="p-2.5 text-center border-r border-slate-200">${d.sd}</td>
                      <td class="p-2.5 text-center border-r border-slate-200">${d.pct}</td>
                      <td class="p-2.5 text-center font-semibold ${d.qColor}">${d.quality}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Section 3: Key Strengths and Priority Support Areas -->
          ${subs.length > 0 ? `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div class="p-5 rounded-xl bg-emerald-50 border border-emerald-200">
                <h4 class="text-sm font-bold text-emerald-900 mb-2 flex items-center gap-1.5">
                  <i class="fas fa-trophy text-emerald-600"></i> จุดเด่นที่พบ (Key Strengths)
                </h4>
                <ul class="text-xs text-emerald-800 space-y-1.5 list-disc list-inside">
                  ${topStrengths.map(d => `<li><strong>${d.name.split('. ')[1] || d.name} (${d.avg}):</strong> มีพัฒนาการในระดับ${d.quality}</li>`).join('')}
                </ul>
              </div>

              <div class="p-5 rounded-xl bg-amber-50 border border-amber-200">
                <h4 class="text-sm font-bold text-amber-900 mb-2 flex items-center gap-1.5">
                  <i class="fas fa-exclamation-triangle text-amber-600"></i> จุดที่ควรเร่งหนุนเสริม (Priority Support Areas)
                </h4>
                <ul class="text-xs text-amber-800 space-y-1.5 list-disc list-inside">
                  ${priorityAreas.map(d => `<li><strong>${d.name.split('. ')[1] || d.name} (${d.avg}):</strong> ควรจัดกิจกรรม Active Learning เพื่อหนุนเสริมอย่างต่อเนื่อง</li>`).join('')}
                </ul>
              </div>
            </div>
          ` : `
            <div class="p-6 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-center text-slate-500 text-xs mb-8">
              <i class="fas fa-chart-line text-slate-400 text-2xl mb-2 block"></i>
              <strong>ยังไม่มีข้อมูลการประเมินในระบบ</strong>
              <p class="mt-1 text-[11px] text-slate-400">เมื่อมีครูหรือสถานศึกษาเริ่มส่งแบบประเมิน ระบบจะประมวลผลจุดเด่น (Key Strengths) และจุดที่ควรเร่งหนุนเสริม (Priority Support Areas) ตามข้อมูลจริงให้อัตโนมัติ</p>
            </div>
          `}

          <!-- Section 4: Policy Recommendations & Action Plan -->
          <div class="mb-8">
            <h3 class="text-base font-bold text-slate-900 uppercase tracking-wide border-l-4 border-blue-600 pl-3 mb-3">
              3. ข้อเสนอแนะเชิงนโยบายและแผนการหนุนเสริม (Action Plan)
            </h3>
            <div class="space-y-3 text-xs text-slate-700">
              <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <strong>1. การขับเคลื่อนวง PLC สม่ำเสมอ:</strong> สนับสนุนให้โรงเรียนจัดตารางแลกเปลี่ยนเรียนรู้ Best Practice ด้าน Active Learning สัปดาห์ละ 1 ครั้ง โดยเน้นการใช้ Active Listening และ AAR
              </div>
              <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <strong>2. การสร้างสัมพันธภาพกับครอบครัว:</strong> สื่อสารข้อมูลพฤติกรรม EF สู่ผู้ปกครองผ่านสมุดสะท้อนคิดดิจิทัล เพื่อให้บ้านและโรงเรียนร่วมกันดูแลเด็กแบบองค์รวม
              </div>
              <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <strong>3. การพัฒนาผู้นิเทศภายใน:</strong> พัฒนาครูแกนนำและผู้บริหารสถานศึกษาให้ทำหน้าที่เป็น Coach ด้าน EF ในระดับสถานศึกษาอย่างยั่งยืน
              </div>
            </div>
          </div>
        </div>
      `}
    `;
  }

  // =========================================================================
  // 7. INDIVIDUAL SCHOOL REPORT VIEW (รายงานสรุปรายโรงเรียน)
  // =========================================================================
  function renderSchoolReportView() {
    const container = document.getElementById('view-school-report');
    if (!container) return;

    const s = state.selectedSchool || (window.NAN1_SCHOOLS || [])[0];
    if (!s) return;

    const subs = (state.submissions || []).filter(sub => sub.schoolId === s.id);
    const subCount = subs.length;
    const avgScore = subCount > 0 ? (subs.reduce((a, b) => a + (Number(b.scoreAvg) || 0), 0) / subCount).toFixed(2) : '-';

    // 1. 5 Sets Submissions Data
    const sSup = subs.filter(x => x.type === 'supervisor');
    const sSch = subs.filter(x => x.type === 'school');
    const sTch = subs.filter(x => x.type === 'teacher');
    const sStu = subs.filter(x => x.type && x.type.startsWith('student_'));
    const sPar = subs.filter(x => x.type && x.type.startsWith('parent_'));

    const tchEarly = sTch.filter(x => x.teachingStage === 'early' || (x.gradeLevel && x.gradeLevel.startsWith('a'))).length;
    const tchPrimary = sTch.length - tchEarly;

    const stuEarly = sStu.filter(x => x.type === 'student_early').length;
    const stuPrimary = sStu.filter(x => x.type === 'student_primary').length;

    const parEarly = sPar.filter(x => x.type === 'parent_early').length;
    const parPrimary = sPar.filter(x => x.type === 'parent_primary').length;

    // Core school mandatory sets (4 sets: รร. + ครู + นร. + ผปค. >= 1 คน)
    let schoolSetsCompleted = 0;
    if (sSch.length > 0) schoolSetsCompleted++;
    if (sTch.length > 0) schoolSetsCompleted++;
    if (sStu.length > 0) schoolSetsCompleted++;
    if (sPar.length >= 1) schoolSetsCompleted++; // Minimum 1 parent per school

    const hasSup = sSup.length > 0;
    const progressPct = Math.round((schoolSetsCompleted / 4) * 100);

    // 2. 9 EF Domains for this School
    const domainDef = [
      { key: 'wm', name: '1. ความจำที่นำมาใช้งาน (Working Memory)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'ic', name: '2. การยั้งคิดไตร่ตรอง (Inhibitory Control)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'sh', name: '3. ความยืดหยุ่นทางความคิด (Shift)', group: 'กลุ่มที่ 1 : ทักษะพื้นฐาน (Basic Skills)', groupKey: 'basic' },
      { key: 'fo', name: '4. การจดจ่อใส่ใจ (Focus / Attention)', group: 'กลุ่มที่ 2 : ทักษะกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'ec', name: '5. การควบคุมอารมณ์ (Emotional Control)', group: 'กลุ่มที่ 2 : ทักษะกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'sm', name: '6. การติดตามประเมินตนเอง (Self-Monitoring)', group: 'กลุ่มที่ 2 : ทักษะกำกับตนเอง (Self-Regulation)', groupKey: 'self' },
      { key: 'in', name: '7. การริเริ่มและลงมือทำ (Initiating)', group: 'กลุ่มที่ 3 : ทักษะลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' },
      { key: 'po', name: '8. การวางแผนและการจัดระบบ (Planning)', group: 'กลุ่มที่ 3 : ทักษะลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' },
      { key: 'gp', name: '9. การมุ่งเป้าหมาย (Goal-Directed)', group: 'กลุ่มที่ 3 : ทักษะลงมือปฏิบัติ (Practice Skills)', groupKey: 'practice' }
    ];

    const schoolDomainStats = domainDef.map(d => {
      let scores = [];
      if (subs.length > 0) {
        subs.forEach(sub => {
          if (sub.domainScores && typeof sub.domainScores[d.key] === 'number') {
            scores.push(sub.domainScores[d.key]);
          } else if (sub.answers && typeof sub.answers === 'object') {
            const matchingKeys = Object.keys(sub.answers).filter(k => k.includes(`_${d.key}_`) || k.startsWith(`${d.key}_`));
            if (matchingKeys.length > 0) {
              const vals = matchingKeys.map(k => Number(sub.answers[k])).filter(v => !isNaN(v));
              if (vals.length > 0) scores.push(vals.reduce((a, b) => a + b, 0) / vals.length);
            } else if (typeof sub.scoreAvg === 'number' && sub.scoreAvg > 0) {
              scores.push(sub.scoreAvg);
            }
          } else if (typeof sub.scoreAvg === 'number' && sub.scoreAvg > 0) {
            scores.push(sub.scoreAvg);
          }
        });
      }

      const count = scores.length;
      const avg = count > 0 ? scores.reduce((a, b) => a + b, 0) / count : 0;
      let sd = 0;
      if (count > 1) {
        const variance = scores.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / (count - 1);
        sd = Math.sqrt(variance);
      }
      const pct = (avg / 3.0) * 100;
      let quality = count > 0 ? (avg >= 2.5 ? 'ระดับดีมาก' : avg >= 1.8 ? 'ระดับพอใช้' : 'ควรหนุนเสริม') : 'รอข้อมูล';
      let qColor = count > 0 ? (avg >= 2.5 ? 'bg-emerald-100 text-emerald-800' : avg >= 1.8 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800') : 'bg-slate-100 text-slate-500';
      let barColor = avg >= 2.5 ? 'bg-emerald-500' : avg >= 1.8 ? 'bg-blue-600' : 'bg-amber-500';

      return {
        ...d,
        count,
        avg: count > 0 ? avg.toFixed(2) : '-',
        sd: count > 1 ? sd.toFixed(2) : '-',
        pct: count > 0 ? pct.toFixed(1) + '%' : '0%',
        pctNum: pct,
        quality,
        qColor,
        barColor,
        numAvg: avg
      };
    });

    const basicDomains = schoolDomainStats.filter(d => d.groupKey === 'basic');
    const basicScore = basicDomains.some(d => d.count > 0) ? (basicDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2) : '-';

    const selfDomains = schoolDomainStats.filter(d => d.groupKey === 'self');
    const selfScore = selfDomains.some(d => d.count > 0) ? (selfDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2) : '-';

    const practiceDomains = schoolDomainStats.filter(d => d.groupKey === 'practice');
    const practiceScore = practiceDomains.some(d => d.count > 0) ? (practiceDomains.reduce((a, b) => a + b.numAvg, 0) / 3).toFixed(2) : '-';

    let qualityTitle = 'ยังไม่มีข้อมูลการประเมิน';
    let qualityBadgeClass = 'bg-slate-100 text-slate-600';
    if (subCount > 0) {
      const num = Number(avgScore);
      if (num >= 2.5) { qualityTitle = 'ระดับดีมาก / เติบโตสู่ความยั่งยืน'; qualityBadgeClass = 'bg-emerald-100 text-emerald-800'; }
      else if (num >= 1.8) { qualityTitle = 'ระดับกำลังเติบโตและปรับตัว'; qualityBadgeClass = 'bg-blue-100 text-blue-800'; }
      else { qualityTitle = 'จุดเริ่มต้นของการหนุนเสริม'; qualityBadgeClass = 'bg-amber-100 text-amber-800'; }
    }

    container.innerHTML = `
      <div class="no-print mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button onclick="window.EF_APP.navigate('school-hub')" class="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2">
            <i class="fas fa-arrow-left"></i> กลับไปยังศูนย์โรงเรียน
          </button>
          <h2 class="text-2xl font-bold text-slate-800">รายงานสรุปผลการประเมินสถานศึกษา: ${s.name}</h2>
          <p class="text-xs text-slate-500">${s.group} • ${s.district} • สพป.น่าน เขต 1</p>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="window.print()" class="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-md">
            <i class="fas fa-print"></i> พิมพ์รายงานสรุป / SAR
          </button>
        </div>
      </div>

      <!-- Printable School Sheet -->
      <div class="academic-card p-6 md:p-10 bg-white border border-slate-300 shadow-xl max-w-5xl mx-auto printable-doc space-y-8">
        <div class="text-center pb-4 border-b-2 border-slate-800">
          <h2 class="text-xl md:text-2xl font-bold text-slate-900">แบบสรุปผลการกำกับ ติดตาม และประเมินผลทักษะสมอง EF ระดับสถานศึกษา</h2>
          <h3 class="text-base md:text-lg font-bold text-blue-900 mt-1">${s.name}</h3>
          <p class="text-xs text-slate-500 mt-1">${s.group} • ${s.district} • ขนาด: ${s.schoolSize} • นักเรียนรวม: ${s.totalStudents} คน • สพป.น่าน เขต 1 (ปี 2569)</p>
        </div>

        <!-- KPI Summary Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="p-5 bg-blue-50/80 rounded-2xl border border-blue-200 text-center">
            <span class="text-xs text-blue-700 font-semibold">คะแนนเฉลี่ย EF รวม</span>
            <div class="text-3xl font-bold text-blue-900 mt-1">${avgScore} <span class="text-xs font-normal text-slate-500">/ 3.00</span></div>
            <span class="inline-block text-[11px] font-semibold ${qualityBadgeClass} px-2.5 py-0.5 rounded-full mt-2">${qualityTitle}</span>
          </div>
          <div class="p-5 bg-emerald-50/80 rounded-2xl border border-emerald-200 text-center">
            <span class="text-xs text-emerald-700 font-semibold">ความคืบหน้าเกณฑ์สถานศึกษา</span>
            <div class="text-3xl font-bold text-emerald-900 mt-1">${schoolSetsCompleted} / 4 <span class="text-xs font-normal text-slate-500">ชุด (${progressPct}%)</span></div>
            <div class="w-full bg-emerald-200 rounded-full h-2 mt-2 overflow-hidden">
              <div class="bg-emerald-600 h-2 rounded-full" style="width: ${progressPct}%"></div>
            </div>
            ${hasSup ? `<p class="text-[11px] text-emerald-700 font-semibold mt-2"><i class="fas fa-check-circle mr-1"></i>มีบันทึกนิเทศของ ศน. (${sSup.length} ชุด)</p>` : ''}
          </div>
          <div class="p-5 bg-slate-50 rounded-2xl border border-slate-200 text-center">
            <span class="text-xs text-slate-600 font-semibold">ชุดข้อมูลที่บันทึกทั้งหมด</span>
            <div class="text-3xl font-bold text-slate-800 mt-1">${subCount} <span class="text-xs font-normal text-slate-500">ชุด</span></div>
            <p class="text-[11px] text-slate-500 mt-2">รวมครู นักเรียน และผู้ปกครอง</p>
          </div>
        </div>

        <!-- 1. ตารางความคืบหน้ารายชุด (5 ชุด) -->
        <div>
          <h4 class="text-sm font-bold text-slate-900 mb-3 border-l-4 border-blue-600 pl-3">
            1. รายการความคืบหน้าการตอบแบบประเมินรายชุด (5 ชุดเครื่องมือ)
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div class="p-4 rounded-xl border ${sSup.length > 0 ? 'bg-blue-50/30 border-blue-300' : 'bg-slate-50 border-slate-200'}">
              <div class="flex items-center justify-between mb-1">
                <strong class="text-xs text-slate-800">ชุดที่ 1 : ศึกษานิเทศก์ (เขตพื้นที่)</strong>
                ${sSup.length > 0 ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">✓ นิเทศแล้ว</span>' : '<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">รอการนิเทศ (ไม่บังคับทุก รร.)</span>'}
              </div>
              <p class="text-[11px] text-slate-600">${sSup.length > 0 ? `บันทึกแล้ว ${sSup.length} ชุด (คะแนนเฉลี่ย ${(sSup.reduce((a,b)=>a+b.scoreAvg,0)/sSup.length).toFixed(2)})` : 'นิเทศเฉพาะกลุ่มเป้าหมาย (ไม่มีเกณฑ์ขั้นต่ำ)'}</p>
            </div>

            <div class="p-4 rounded-xl border ${sSch.length > 0 ? 'bg-emerald-50/30 border-emerald-300' : 'bg-slate-50 border-slate-200'}">
              <div class="flex items-center justify-between mb-1">
                <strong class="text-xs text-slate-800">ชุดที่ 2 : สถานศึกษา (ขั้นต่ำ: 1 ชุด)</strong>
                ${sSch.length > 0 ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">✓ ดำเนินการแล้ว</span>' : '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">✕ ยังไม่ดำเนินการ</span>'}
              </div>
              <p class="text-[11px] text-slate-600">${sSch.length > 0 ? `ประเมินตนเองแล้ว (คะแนน ${(Number(sSch[0].scoreAvg)||0).toFixed(2)})` : 'ยังไม่บันทึกประเมินตนเอง'}</p>
            </div>

            <div class="p-4 rounded-xl border ${sTch.length > 0 ? 'bg-emerald-50/30 border-emerald-300' : 'bg-slate-50 border-slate-200'}">
              <div class="flex items-center justify-between mb-1">
                <strong class="text-xs text-slate-800">ชุดที่ 3 : ครูผู้สอน (ขั้นต่ำ: 1 คน)</strong>
                ${sTch.length > 0 ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">✓ ดำเนินการแล้ว (${sTch.length} คน)</span>` : '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">✕ ยังไม่ดำเนินการ</span>'}
              </div>
              <p class="text-[11px] text-slate-600">${sTch.length > 0 ? `ปฐมวัย: ${tchEarly} คน • สุขศึกษา/พลฯ: ${tchPrimary} คน` : 'ยังไม่มีครูส่งแบบประเมิน'}</p>
            </div>

            <div class="p-4 rounded-xl border ${sStu.length > 0 ? 'bg-emerald-50/30 border-emerald-300' : 'bg-slate-50 border-slate-200'}">
              <div class="flex items-center justify-between mb-1">
                <strong class="text-xs text-slate-800">ชุดที่ 4 : เด็ก/นักเรียน (ขั้นต่ำ: 1 คน)</strong>
                ${sStu.length > 0 ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">✓ ดำเนินการแล้ว (${sStu.length} คน)</span>` : '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">✕ ยังไม่ดำเนินการ</span>'}
              </div>
              <p class="text-[11px] text-slate-600">${sStu.length > 0 ? `ปฐมวัย: ${stuEarly} คน • ประถม ป.1-3: ${stuPrimary} คน` : 'ยังไม่มีการประเมินนักเรียน'}</p>
            </div>

            <div class="p-4 rounded-xl border ${sPar.length >= 1 ? 'bg-emerald-50/30 border-emerald-300' : 'bg-rose-50/30 border-rose-200'}">
              <div class="flex items-center justify-between mb-1">
                <strong class="text-xs text-slate-800">ชุดที่ 5 : ผู้ปกครอง (ขั้นต่ำ: 1 คน)</strong>
                ${sPar.length >= 1 ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">✓ ผ่านเกณฑ์ (${sPar.length} คน)</span>` : '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">✕ ยังไม่ถึงเกณฑ์</span>'}
              </div>
              <p class="text-[11px] text-slate-600">${sPar.length > 0 ? `ปฐมวัย: ${parEarly} คน • ประถม: ${parPrimary} คน` : 'ยังไม่มีผู้ปกครองตอบ (เกณฑ์ขั้นต่ำ 1 คน)'}</p>
            </div>
          </div>
        </div>

        <!-- 2. ผลการประเมินทักษะสมอง EF 9 ด้านเฉพาะของสถานศึกษา -->
        <div>
          <h4 class="text-sm font-bold text-slate-900 mb-3 border-l-4 border-indigo-600 pl-3">
            2. ผลการประเมินสมรรถนะทักษะสมอง EF จำแนกตาม 9 ด้าน (ระดับสถานศึกษา)
          </h4>
          <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th class="p-2.5 text-center w-10">#</th>
                  <th class="p-2.5">ด้านทักษะสมอง (EF Domain)</th>
                  <th class="p-2.5 text-center w-20">ข้อมูล (ชุด)</th>
                  <th class="p-2.5 text-center w-24">คะแนน (x̄)</th>
                  <th class="p-2.5 text-center w-16">S.D.</th>
                  <th class="p-2.5 w-32">การเติบโต (%)</th>
                  <th class="p-2.5 text-center w-28">ระดับคุณภาพ</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${schoolDomainStats.map((d, idx) => `
                  <tr class="hover:bg-slate-50">
                    <td class="p-2.5 text-center font-bold text-slate-400">${idx + 1}</td>
                    <td class="p-2.5 font-medium text-slate-800">${d.name}</td>
                    <td class="p-2.5 text-center font-semibold text-slate-600">${d.count}</td>
                    <td class="p-2.5 text-center">
                      <strong class="text-sm ${d.avg !== '-' ? (Number(d.avg) >= 2.5 ? 'text-emerald-700' : Number(d.avg) >= 1.8 ? 'text-blue-700' : 'text-amber-700') : 'text-slate-400'}">${d.avg}</strong>
                    </td>
                    <td class="p-2.5 text-center font-mono text-slate-500">${d.sd}</td>
                    <td class="p-2.5">
                      <div class="flex items-center gap-1.5">
                        <div class="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div class="${d.barColor} h-1.5 rounded-full" style="width: ${d.pctNum}%"></div>
                        </div>
                        <span class="text-[10px] font-mono text-slate-500 shrink-0">${d.pct}</span>
                      </div>
                    </td>
                    <td class="p-2.5 text-center">
                      <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${d.qColor}">
                        ${d.quality}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- 3. ประวัติการบันทึกของโรงเรียน -->
        <div>
          <h4 class="text-sm font-bold text-slate-800 mb-3 border-b border-slate-100 pb-2 flex items-center justify-between">
            <span><i class="fas fa-history text-blue-600 mr-1.5"></i> 3. รายการบันทึกการประเมินของโรงเรียน (ประวัติตรวจสอบย้อนหลัง)</span>
            <span class="text-xs text-slate-500 font-normal">คลิก "ตรวจสอบคำตอบ" เพื่อดูรายข้อ</span>
          </h4>
          <div class="space-y-3">
            ${subs.length > 0 ? subs.map(sub => `
              <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-100/70 transition">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-slate-800">${sub.typeName}</span>
                    <span class="text-[10px] font-mono bg-slate-200/70 text-slate-600 px-2 py-0.5 rounded-full">${sub.id}</span>
                    ${sub.attachment ? `<span class="inline-flex items-center gap-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold" title="${sub.attachment.name}"><i class="fas fa-paperclip"></i> ไฟล์แนบ</span>` : ''}
                  </div>
                  <p class="text-[11px] text-slate-500 mt-1">
                    ผู้ประเมิน: <strong>${sub.evaluator || '-'}</strong>
                    ${sub.recipientName || sub.studentName ? ` • ผู้รับการประเมิน/นร.: <strong>${sub.recipientName || sub.studentName}</strong>` : ''}
                    ${sub.gradeLevelName ? ` • ชั้น: <strong>${sub.gradeLevelName}</strong>` : ''}
                    • วันที่: <strong>${formatThaiDate(sub.date)}</strong>
                  </p>
                </div>
                <div class="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  <div class="text-right">
                    <span class="text-sm font-bold text-blue-700">${(Number(sub.scoreAvg) || 0).toFixed(2)}</span>
                    <span class="text-[10px] block text-slate-500">${sub.qualityLevel}</span>
                  </div>
                  <div class="flex items-center gap-1.5 border-l border-slate-200 pl-3">
                    <button onclick="window.EF_APP.viewSubmissionDetail('${sub.id}')" class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm flex items-center gap-1 transition" title="คลิกเพื่อตรวจสอบคำตอบย้อนหลัง">
                      <i class="fas fa-search-plus"></i>
                      <span>ตรวจสอบคำตอบ</span>
                    </button>
                    <button onclick="window.EF_APP.deleteSubmission('${sub.id}', '${s.id}')" class="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition" title="ลบรายการนี้ (กรณีบันทึกผิดพลาด)">
                      <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                  </div>
                </div>
              </div>
            `).join('') : '<p class="text-xs text-slate-400 py-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">ยังไม่มีข้อมูลการประเมินที่บันทึกสำหรับโรงเรียนนี้</p>'}
          </div>
        </div>

        <!-- 4. เอกสารและภาพถ่ายร่องรอยหลักฐานแนบของสถานศึกษา -->
        <div>
          <h4 class="text-sm font-bold text-slate-800 mb-3 border-b border-slate-100 pb-2 flex items-center justify-between">
            <span><i class="fas fa-photo-video text-indigo-600 mr-1.5"></i> 4. เอกสารและภาพถ่ายร่องรอยหลักฐานแนบของสถานศึกษา (${(() => {
              const sMedia = getAllMediaItems().filter(m => m.schoolId === s.id);
              return sMedia.length;
            })()} รายการ)</span>
            <span class="text-xs text-slate-500 font-normal">ใช้เป็นหลักฐานประกอบรายงาน SAR และผลงาน Best Practice</span>
          </h4>

          ${(() => {
            const sMedia = getAllMediaItems().filter(m => m.schoolId === s.id);
            if (sMedia.length === 0) {
              return `
                <div class="p-5 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-400">
                  <i class="fas fa-paperclip text-slate-300 text-xl mb-1.5 block"></i>
                  ยังไม่มีการแนบไฟล์หรือภาพถ่ายร่องรอยสำหรับโรงเรียนนี้ (สามารถแนบได้ในแบบประเมินชุดที่ 1 ศน., ชุดที่ 2 สถานศึกษา, และชุดที่ 3 ครูผู้สอน)
                </div>
              `;
            }

            return `
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                ${sMedia.map(m => `
                  <div class="media-card p-3 rounded-2xl bg-white border border-slate-200 shadow-sm flex flex-col justify-between hover:border-blue-300">
                    <div class="flex items-center gap-3 cursor-pointer" onclick="window.EF_APP.openMediaLightbox('${m.id}')">
                      <div class="w-12 h-12 rounded-xl overflow-hidden bg-slate-900 flex items-center justify-center shrink-0 shadow-sm">
                        ${m.isImage && (m.thumbnailUrl || m.base64) ? `
                          <img src="${m.thumbnailUrl || m.base64}" alt="${m.name}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-image text-slate-400\\'></i>'">
                        ` : `
                          <i class="${m.isPdf ? 'fas fa-file-pdf text-rose-500 text-lg' : m.isDoc ? 'fas fa-file-word text-blue-500 text-lg' : 'fas fa-file-alt text-slate-400 text-lg'}"></i>
                        `}
                      </div>
                      <div class="min-w-0">
                        <span class="text-xs font-bold text-slate-900 block truncate" title="${m.name}">${m.name}</span>
                        <span class="text-[10px] text-slate-500 block">${m.formTypeName} • ${formatThaiDate(m.date)}</span>
                      </div>
                    </div>
                    <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
                      <button type="button" onclick="window.EF_APP.openMediaLightbox('${m.id}')" class="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[10px] flex items-center gap-1">
                        <i class="fas fa-search-plus"></i> เปิดดู
                      </button>
                      <button type="button" onclick="window.EF_APP.copyMediaUrl('${m.url}')" class="p-1 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px]" title="คัดลอกลิงก์">
                        <i class="fas fa-copy text-amber-500"></i>
                      </button>
                      <a href="${m.downloadUrl || m.url}" target="_blank" download="${m.name}" class="p-1 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px]" title="ดาวน์โหลด">
                        <i class="fas fa-download"></i>
                      </a>
                    </div>
                  </div>
                `).join('')}
              </div>
            `;
          })()}
        </div>

        <!-- 5. แนวทางการหนุนเสริมสถานศึกษา -->
        <div class="p-5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
          <strong class="text-slate-900">5. แนวทางการหนุนเสริมสถานศึกษา (Action Plan & SAR Recommendation):</strong>
          <p>ส่งเสริมให้ครูผู้สอนระดับปฐมวัย และครูสุขศึกษาและพลศึกษา ชั้น ป.1-3 จัดกิจกรรม Active Learning ผ่าน 6 โอกาสอย่างต่อเนื่อง และนำผลประเมินพฤติกรรม EF มาเป็นข้อมูลชี้เป้าในการช่วยเหลือนักเรียนเป็นรายบุคคลผ่านกระบวนการ PLC ภายในสถานศึกษา</p>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 8. USER GUIDE VIEW (คู่มือการใช้งานระบบสำหรับครูและสถานศึกษา)
  // =========================================================================
  function renderUserGuideView() {
    const container = document.getElementById('view-user-guide');
    if (!container) return;

    container.innerHTML = `
      <!-- User Guide Header Bar -->
      <div class="no-print mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="px-3 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">คู่มือการใช้งานระบบดิจิทัล</span>
            <span class="text-xs text-slate-400">สพป.น่าน เขต 1</span>
          </div>
          <h2 class="text-2xl md:text-3xl font-bold text-slate-800">คู่มือการใช้งานระบบประเมินทักษะสมอง EF 69</h2>
          <p class="text-xs text-slate-500">สำหรับผู้บริหารสถานศึกษา ครูผู้สอน ศึกษานิเทศก์ และผู้ปกครอง</p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <button onclick="window.print()" class="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-2 shadow-md transition">
            <i class="fas fa-print"></i>
            <span>พิมพ์คู่มือ / บันทึก PDF</span>
          </button>
          <button onclick="window.EF_APP.navigate('school-hub')" class="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 shadow-md transition">
            <i class="fas fa-school"></i>
            <span>ไปยังโรงเรียนในสังกัด & ส่งลิงก์</span>
          </button>
        </div>
      </div>

      <!-- Printable Manual Document -->
      <div class="academic-card p-6 md:p-10 bg-white border border-slate-300 shadow-xl max-w-5xl mx-auto space-y-10 printable-doc">
        
        <!-- Document Cover / Header -->
        <div class="text-center pb-6 border-b-2 border-slate-800">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-700 to-indigo-900 text-amber-300 text-3xl font-bold mb-3 shadow-lg shadow-blue-500/20">
            <i class="fas fa-book-open"></i>
          </div>
          <h1 class="text-2xl md:text-3xl font-bold text-slate-900">คู่มือการใช้งานระบบการกำกับ ติดตาม และประเมินผล</h1>
          <h2 class="text-lg md:text-xl font-bold text-blue-900 mt-1">โครงการสร้างภูมิคุ้มกันและพัฒนาทักษะสมอง (Executive Functions : EF)</h2>
          <p class="text-sm text-slate-600 mt-2">
            สำนักงานเขตพื้นที่การศึกษาประถมศึกษาน่าน เขต 1 ประจำปีการศึกษา 2569
          </p>
          <p class="text-xs text-slate-500 mt-1">
            ผู้รับผิดชอบโครงการ: นายพุฒิพงษ์ วงศ์นันท์ ศึกษานิเทศก์ (โทร. 086-1161126)
          </p>
        </div>

        <!-- ระบบนี้มีไว้ทำอะไร -->
        <div>
          <h3 class="text-base font-bold text-slate-900 border-l-4 border-blue-600 pl-3 mb-4">ระบบนี้มีไว้ทำอะไร?</h3>
          <p class="text-sm text-slate-700 leading-relaxed mb-4">
            ระบบนี้คือ <strong>แพลตฟอร์มดิจิทัลสำหรับโรงเรียน 145 แห่ง</strong> ในสังกัด สพป.น่าน เขต 1 ใช้สำหรับ:
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="p-4 rounded-xl bg-blue-50 border border-blue-200 text-center">
              <div class="text-2xl mb-1">📋</div>
              <strong class="text-sm text-blue-900 block">ทำแบบประเมิน</strong>
              <p class="text-[11px] text-blue-700 mt-1">ประเมินตามบทบาทของตนเองผ่านมือถือหรือคอมพิวเตอร์</p>
            </div>
            <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
              <div class="text-2xl mb-1">📊</div>
              <strong class="text-sm text-emerald-900 block">ดูผลรายงาน</strong>
              <p class="text-[11px] text-emerald-700 mt-1">ระบบประมวลผลและแสดงคะแนน EF ของโรงเรียนให้อัตโนมัติ</p>
            </div>
            <div class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center">
              <div class="text-2xl mb-1">🔗</div>
              <strong class="text-sm text-amber-900 block">ส่งต่อลิงก์ / QR</strong>
              <p class="text-[11px] text-amber-700 mt-1">แชร์แบบประเมินเฉพาะโรงเรียนผ่าน LINE ได้ใน 1 วินาที</p>
            </div>
          </div>
        </div>

        <!-- ฉันควรใช้แบบประเมินชุดไหน -->
        <div>
          <h3 class="text-base font-bold text-slate-900 border-l-4 border-emerald-600 pl-3 mb-4">ฉันควรทำแบบประเมินชุดไหน?</h3>
          <p class="text-sm text-slate-600 mb-4">เลือกตามบทบาทของท่านได้เลยครับ:</p>

          <div class="space-y-3">
            <div class="flex items-start gap-4 p-4 rounded-xl bg-blue-50 border border-blue-200">
              <div class="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold shrink-0">ชุด 1</div>
              <div class="flex-1">
                <strong class="text-sm text-blue-900">ศึกษานิเทศก์</strong>
                <p class="text-xs text-blue-700 mt-0.5">ใช้เมื่อออกนิเทศ ติดตาม สถานศึกษา — ประเมินบทบาท Coach ของตนเอง และการขับเคลื่อน EF ในโรงเรียน</p>
                <span class="inline-block mt-1.5 text-[11px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">10 ข้อ • สำหรับศึกษานิเทศก์</span>
              </div>
              <button onclick="window.EF_APP.openForm('supervisor')" class="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition">ทำเลย</button>
            </div>

            <div class="flex items-start gap-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <div class="w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center text-sm font-bold shrink-0">ชุด 2</div>
              <div class="flex-1">
                <strong class="text-sm text-amber-900">ผู้บริหารสถานศึกษา</strong>
                <p class="text-xs text-amber-700 mt-0.5">ประเมินการขับเคลื่อนนโยบาย EF ระดับโรงเรียน สภาพแวดล้อม และแผนปฏิบัติการ</p>
                <span class="inline-block mt-1.5 text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">20 ข้อ • สำหรับสถานศึกษา</span>
              </div>
              <button onclick="window.EF_APP.openForm('school')" class="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition">ทำเลย</button>
            </div>

            <div class="flex items-start gap-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <div class="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-bold shrink-0">ชุด 3</div>
              <div class="flex-1">
                <strong class="text-sm text-emerald-900">ครูผู้สอน</strong>
                <p class="text-xs text-emerald-700 mt-0.5">ประเมินการจัดการเรียนรู้เชิงรุก (Active Learning 6 โอกาส) วินัยเชิงบวก และการมีส่วนร่วมของผู้ปกครอง</p>
                <span class="inline-block mt-1.5 text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">18 ข้อ • แยกปฐมวัย / ประถม</span>
              </div>
              <button onclick="window.EF_APP.openForm('teacher')" class="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition">ทำเลย</button>
            </div>

            <div class="flex items-start gap-4 p-4 rounded-xl bg-sky-50 border border-sky-200">
              <div class="w-10 h-10 rounded-full bg-sky-600 text-white flex items-center justify-center text-sm font-bold shrink-0">ชุด 4</div>
              <div class="flex-1">
                <strong class="text-sm text-sky-900">ครูผู้สอน (ประเมินพฤติกรรมนักเรียน)</strong>
                <p class="text-xs text-sky-700 mt-0.5">สังเกตพฤติกรรมทักษะสมอง EF 9 ด้านของเด็ก เช่น ความจำ, การยั้งคิด, การวางแผน ฯลฯ</p>
                <div class="flex gap-2 mt-1.5">
                  <span class="text-[11px] bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full">ปฐมวัย (อ.1–3)</span>
                  <span class="text-[11px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">ประถม (ป.1–3)</span>
                </div>
              </div>
              <div class="flex flex-col gap-1 shrink-0">
                <button onclick="window.EF_APP.openForm('student_early')" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition">ปฐมวัย</button>
                <button onclick="window.EF_APP.openForm('student_primary')" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition">ประถม</button>
              </div>
            </div>

            <div class="flex items-start gap-4 p-4 rounded-xl bg-rose-50 border border-rose-200">
              <div class="w-10 h-10 rounded-full bg-rose-600 text-white flex items-center justify-center text-sm font-bold shrink-0">ชุด 5</div>
              <div class="flex-1">
                <strong class="text-sm text-rose-900">ผู้ปกครองนักเรียน</strong>
                <p class="text-xs text-rose-700 mt-0.5">ประเมินตนเองว่าส่งเสริม EF ลูกที่บ้านอย่างไร และสังเกตพฤติกรรมลูกในชีวิตประจำวัน</p>
                <div class="flex gap-2 mt-1.5">
                  <span class="text-[11px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full">สำหรับผู้ปกครอง</span>
                  <span class="text-[11px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">36 ข้อ</span>
                </div>
              </div>
              <div class="flex flex-col gap-1 shrink-0">
                <button onclick="window.EF_APP.openForm('parent_early')" class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition">เด็กปฐมวัย</button>
                <button onclick="window.EF_APP.openForm('parent_primary')" class="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition">เด็กประถม</button>
              </div>
            </div>
          </div>
        </div>

        <!-- การให้คะแนน -->
        <div>
          <h3 class="text-base font-bold text-slate-900 border-l-4 border-amber-500 pl-3 mb-4">การให้คะแนน — ทำอย่างไร?</h3>
          <p class="text-sm text-slate-700 mb-3">แต่ละข้อในแบบประเมินจะมีให้เลือก <strong>3 ระดับ</strong> ตามความเป็นจริง:</p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <div class="text-2xl mb-1">🟢</div>
              <strong class="text-sm text-emerald-900 block">3 คะแนน — ดีมาก</strong>
              <p class="text-xs text-emerald-800 mt-1 leading-relaxed">ทำได้สม่ำเสมอ เห็นผลชัดเจน เป็นแบบอย่างที่ดีได้</p>
            </div>
            <div class="p-4 rounded-xl bg-blue-50 border border-blue-200">
              <div class="text-2xl mb-1">🟡</div>
              <strong class="text-sm text-blue-900 block">2 คะแนน — พอใช้</strong>
              <p class="text-xs text-blue-800 mt-1 leading-relaxed">ทำบ้างแล้ว แต่ยังไม่สม่ำเสมอ อยู่ระหว่างการพัฒนา</p>
            </div>
            <div class="p-4 rounded-xl bg-amber-50 border border-amber-200">
              <div class="text-2xl mb-1">🔴</div>
              <strong class="text-sm text-amber-900 block">1 คะแนน — ควรพัฒนา</strong>
              <p class="text-xs text-amber-800 mt-1 leading-relaxed">ยังไม่ได้ลงมือปฏิบัติ หรือทำน้อยมาก ต้องการการสนับสนุน</p>
            </div>
          </div>
          <div class="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
            <i class="fas fa-lightbulb text-amber-500 mr-1.5"></i>
            <strong>เคล็ดลับ:</strong> กรอกตามความเป็นจริงมากที่สุด — ข้อมูลที่ถูกต้องช่วยให้ระบบวิเคราะห์จุดเด่นและพื้นที่ต้องพัฒนาได้แม่นยำกว่า
          </div>
        </div>

        <!-- วิธีส่งลิงก์ -->
        <div>
          <h3 class="text-base font-bold text-slate-900 border-l-4 border-purple-600 pl-3 mb-4">วิธีส่งลิงก์แบบประเมินให้ครูและผู้ปกครอง (สำหรับผู้บริหาร/ครูแกนนำ)</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div class="flex items-center gap-2">
                <span class="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
                <strong class="text-sm text-slate-800">ไปที่เมนู "โรงเรียนในสังกัด"</strong>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                <strong class="text-sm text-slate-800">ค้นหาชื่อหรือรหัสโรงเรียนของท่าน</strong>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
                <strong class="text-sm text-slate-800">กดปุ่ม "คัดลอกลิงก์" → ส่งใน LINE กลุ่มครูได้เลย</strong>
              </div>
              <div class="p-2.5 bg-blue-50 rounded-lg border border-blue-200">
                <p class="text-[11px] text-blue-700">✅ ลิงก์จะล็อกรหัสโรงเรียนให้อัตโนมัติ — ครูไม่ต้องพิมพ์ชื่อโรงเรียนเอง</p>
              </div>
            </div>

            <div class="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div class="flex items-center gap-2">
                <span class="w-7 h-7 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center shrink-0">📱</span>
                <strong class="text-sm text-slate-800">หรือใช้การ์ด QR Code</strong>
              </div>
              <p class="text-xs text-slate-600 leading-relaxed">
                กดปุ่ม <strong>"พิมพ์การ์ด QR"</strong> แล้วสั่งพิมพ์กระดาษ A4<br>
                นำไปวางโต๊ะประชุมผู้ปกครอง หรือติดบอร์ดในโรงเรียน<br>
                ผู้ปกครองสแกนด้วยมือถือได้ทันที
              </p>
              <div class="p-2.5 bg-purple-50 rounded-lg border border-purple-200">
                <p class="text-[11px] text-purple-700">✅ ไม่ต้องพิมพ์หรือแจกเอกสารแบบประเมินกระดาษอีกต่อไป</p>
              </div>
            </div>
          </div>
        </div>

        <!-- หลังส่งแบบประเมิน -->
        <div>
          <h3 class="text-base font-bold text-slate-900 border-l-4 border-teal-600 pl-3 mb-4">หลังส่งแบบประเมินแล้ว — จะเกิดอะไรขึ้น?</h3>
          <div class="space-y-3">
            <div class="flex items-start gap-3 p-4 rounded-xl bg-teal-50 border border-teal-200">
              <div class="text-xl shrink-0 mt-0.5">🎉</div>
              <div>
                <strong class="text-sm text-teal-900">รับใบยืนยันผลทันที</strong>
                <p class="text-xs text-teal-700 mt-0.5">ระบบจะแสดงหน้าต่างสรุปผลพร้อม <strong>รหัสอ้างอิง</strong> (เช่น SUB-1724...), คะแนนเฉลี่ย, วันที่บันทึก และระดับคุณภาพ</p>
              </div>
            </div>
            <div class="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200">
              <div class="text-xl shrink-0 mt-0.5">🔍</div>
              <div>
                <strong class="text-sm text-blue-900">ตรวจคำตอบย้อนหลังได้ทุกข้อ</strong>
                <p class="text-xs text-blue-700 mt-0.5">คลิกปุ่ม <strong>"ตรวจสอบคำตอบย้อนหลัง"</strong> เพื่อเปิดดูว่าตัวเองตอบอะไรไว้ในแต่ละข้อ พร้อมคำอธิบายเกณฑ์</p>
              </div>
            </div>
            <div class="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div class="text-xl shrink-0 mt-0.5">📈</div>
              <div>
                <strong class="text-sm text-slate-900">ดูรายงานผลรวมของโรงเรียน</strong>
                <p class="text-xs text-slate-600 mt-0.5">เข้าเมนู <strong>"โรงเรียนในสังกัด"</strong> → ค้นหาโรงเรียน → กด <strong>"ดูรายงานโรงเรียนนี้"</strong> เพื่อดูสรุปคะแนน EF ภาพรวม และพิมพ์ PDF แนบ SAR ได้</p>
              </div>
            </div>
          </div>
        </div>

        <!-- FAQ -->
        <div>
          <h3 class="text-base font-bold text-slate-900 border-l-4 border-slate-500 pl-3 mb-4">คำถามที่พบบ่อย</h3>
          <div class="space-y-3">
            <details class="group p-4 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <summary class="text-sm font-semibold text-slate-800 flex items-center justify-between list-none">
                <span>🔑 ต้องสมัครสมาชิกหรือจำรหัสผ่านก่อนทำแบบประเมินไหม?</span>
                <i class="fas fa-chevron-down text-slate-400 text-xs group-open:rotate-180 transition-transform"></i>
              </summary>
              <p class="text-xs text-slate-600 mt-2 leading-relaxed pt-2 border-t border-slate-200">
                <strong>ไม่ต้องเลยครับ!</strong> เพียงสแกน QR Code หรือคลิกลิงก์ที่โรงเรียนส่งให้ ก็เข้าทำแบบประเมินได้ทันที ไม่ต้องจำรหัสผ่านหรือสมัครสมาชิก
              </p>
            </details>
            <details class="group p-4 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <summary class="text-sm font-semibold text-slate-800 flex items-center justify-between list-none">
                <span>📱 ทำผ่านมือถือได้ไหม?</span>
                <i class="fas fa-chevron-down text-slate-400 text-xs group-open:rotate-180 transition-transform"></i>
              </summary>
              <p class="text-xs text-slate-600 mt-2 leading-relaxed pt-2 border-t border-slate-200">
                <strong>ได้เลย!</strong> ระบบรองรับมือถือทุกรุ่น (iPhone / Android), แท็บเล็ต, iPad และคอมพิวเตอร์ หน้าจอจะปรับขนาดให้อ่านง่ายและกดตอบได้สะดวก
              </p>
            </details>
            <details class="group p-4 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <summary class="text-sm font-semibold text-slate-800 flex items-center justify-between list-none">
                <span>😰 กรอกข้อมูลผิด ยังแก้ได้ไหม?</span>
                <i class="fas fa-chevron-down text-slate-400 text-xs group-open:rotate-180 transition-transform"></i>
              </summary>
              <p class="text-xs text-slate-600 mt-2 leading-relaxed pt-2 border-t border-slate-200">
                กรณีส่งข้อมูลไปแล้ว ให้จด <strong>รหัสอ้างอิง</strong> ไว้ จากนั้นแจ้งผู้รับผิดชอบโครงการ (ศน.พุฒิพงษ์ วงศ์นันท์ โทร. 086-1161126) เพื่อดำเนินการลบรายการดังกล่าวออก แล้วส่งใหม่อีกครั้งได้ครับ
              </p>
            </details>
            <details class="group p-4 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <summary class="text-sm font-semibold text-slate-800 flex items-center justify-between list-none">
                <span>📄 พิมพ์รายงานออกมาเป็นเอกสารได้ไหม?</span>
                <i class="fas fa-chevron-down text-slate-400 text-xs group-open:rotate-180 transition-transform"></i>
              </summary>
              <p class="text-xs text-slate-600 mt-2 leading-relaxed pt-2 border-t border-slate-200">
                ได้ครับ! ทั้งหน้ารายงานโรงเรียน, รายงานสารสนเทศเขต และคู่มือฉบับนี้ มีปุ่ม <strong>"พิมพ์ / บันทึก PDF"</strong> ทุกหน้า สามารถนำไปแนบเป็นหลักฐาน SAR ได้
              </p>
            </details>
            <details class="group p-4 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
              <summary class="text-sm font-semibold text-slate-800 flex items-center justify-between list-none">
                <span>📎 จำเป็นต้องแนบไฟล์เอกสารหรือรูปภาพทุกครั้งไหม?</span>
                <i class="fas fa-chevron-down text-slate-400 text-xs group-open:rotate-180 transition-transform"></i>
              </summary>
              <p class="text-xs text-slate-600 mt-2 leading-relaxed pt-2 border-t border-slate-200">
                <strong>ไม่ต้องบังคับครับ!</strong> ช่องแนบไฟล์เอกสาร/ภาพถ่ายสำหรับศึกษานิเทศก์ โรงเรียน และครูผู้สอนเป็นแบบเลือกได้ (Optional) หากมีร่องรอยการปฏิบัติงาน เช่น ภาพกิจกรรม Active Learning หรือแผนการจัดการเรียนรู้ สามารถแนบไฟล์ (PDF, Word, JPG, PNG ขนาดไม่เกิน 100 MB) ประกอบการประเมินได้เลยครับ
              </p>
            </details>
          </div>
        </div>

        <!-- Footer -->
        <div class="pt-4 border-t border-slate-200 text-center text-[11px] text-slate-400">
          หากพบปัญหาการใช้งาน กรุณาติดต่อ <strong class="text-slate-600">ศน.พุฒิพงษ์ วงศ์นันท์</strong> ผู้รับผิดชอบโครงการ สพป.น่าน เขต 1 (โทร. 086-1161126)
        </div>

      </div>
    `;
  }

  // =========================================================================
  // =========================================================================
  // 9. DATABASE EXPORT & PRINT HELPERS (CSV & EXCEL WITH CUSTOM TYPES)
  // =========================================================================

  function escapeCSV(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  }

  function downloadCSV(filename, csvContent) {
    const bom = '\uFEFF'; // UTF-8 BOM for Thai language support in MS Excel
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`ดาวน์โหลดไฟล์ CSV เรียบร้อยแล้ว (${filename})`, 'success');
  }

  function convertJsonToCSV(jsonData) {
    if (!jsonData || jsonData.length === 0) return '';
    const headers = Object.keys(jsonData[0]);
    const headerRow = headers.map(escapeCSV).join(',');
    const dataRows = jsonData.map(row => {
      return headers.map(h => escapeCSV(row[h])).join(',');
    });
    return [headerRow, ...dataRows].join('\r\n');
  }

  function getSelectedExportFilters() {
    const type = (document.querySelector('input[name="export-report-type"]:checked') || {}).value || 'progress';
    const group = ((document.getElementById('export-filter-group') || {}).value || 'all');
    const district = ((document.getElementById('export-filter-district') || {}).value || 'all');
    const status = ((document.getElementById('export-filter-status') || {}).value || 'all');
    const instrument = ((document.getElementById('export-filter-instrument') || {}).value || 'all');
    return { type, group, district, status, instrument };
  }

  function resetExportFilters() {
    const grp = document.getElementById('export-filter-group');
    const dst = document.getElementById('export-filter-district');
    const sts = document.getElementById('export-filter-status');
    const ins = document.getElementById('export-filter-instrument');
    if (grp) grp.value = 'all';
    if (dst) dst.value = 'all';
    if (sts) sts.value = 'all';
    if (ins) ins.value = 'all';
    updateExportProgressPreview();
  }

  function filterSchoolsForExport(filters) {
    const schools = window.NAN1_SCHOOLS || [];
    const subs = state.submissions || [];

    return schools.filter(s => {
      if (filters.group !== 'all' && s.group !== filters.group) return false;
      if (filters.district !== 'all' && s.district !== filters.district) return false;

      const sSubs = subs.filter(sub => sub.schoolId === s.id);
      const sSup = sSubs.filter(x => x.type === 'supervisor');
      const sSch = sSubs.filter(x => x.type === 'school');
      const sTch = sSubs.filter(x => x.type === 'teacher');
      const sStu = sSubs.filter(x => x.type && x.type.startsWith('student_'));
      const sPar = sSubs.filter(x => x.type && x.type.startsWith('parent_'));

      let schoolSetsCompleted = 0;
      if (sSch.length > 0) schoolSetsCompleted++;
      if (sTch.length > 0) schoolSetsCompleted++;
      if (sStu.length > 0) schoolSetsCompleted++;
      if (sPar.length >= 1) schoolSetsCompleted++;

      const hasSup = sSup.length > 0;
      const isSchoolCompleted = schoolSetsCompleted === 4;

      if (filters.status === 'completed' && !isSchoolCompleted) return false;
      if (filters.status === 'partial' && (schoolSetsCompleted === 0 || isSchoolCompleted)) return false;
      if (filters.status === 'none' && (schoolSetsCompleted > 0 || hasSup)) return false;
      if (filters.status === 'has_sup' && !hasSup) return false;
      if (filters.status === 'has_sch' && sSch.length === 0) return false;
      if (filters.status === 'has_tch' && sTch.length === 0) return false;
      if (filters.status === 'has_stu' && sStu.length === 0) return false;
      if (filters.status === 'has_par' && sPar.length === 0) return false;
      if (filters.status === 'missing_sch' && sSch.length > 0) return false;
      if (filters.status === 'missing_tch' && sTch.length > 0) return false;
      if (filters.status === 'missing_stu' && sStu.length > 0) return false;
      if (filters.status === 'missing_par' && sPar.length >= 1) return false;

      return true;
    });
  }

  function filterSubmissionsForExport(filters) {
    let subs = state.submissions || [];
    const matchedSchools = new Set(filterSchoolsForExport(filters).map(s => s.id));

    subs = subs.filter(s => matchedSchools.has(s.schoolId));

    if (filters.instrument && filters.instrument !== 'all') {
      if (filters.instrument === 'teacher_early') {
        subs = subs.filter(s => s.type === 'teacher' && (s.teachingStage === 'early' || (s.gradeLevel && s.gradeLevel.startsWith('a'))));
      } else if (filters.instrument === 'teacher_primary') {
        subs = subs.filter(s => s.type === 'teacher' && (s.teachingStage === 'primary' || (s.gradeLevel && s.gradeLevel.startsWith('p'))));
      } else if (filters.instrument === 'teacher') {
        subs = subs.filter(s => s.type === 'teacher');
      } else {
        subs = subs.filter(s => s.type === filters.instrument);
      }
    }

    return subs;
  }

  function updateExportProgressPreview() {
    const filters = getSelectedExportFilters();

    // Toggle instrument dropdown visibility
    const instContainer = document.getElementById('export-instrument-container');
    if (instContainer) {
      if (filters.type === 'instrument' || filters.type === 'raw') {
        instContainer.classList.remove('hidden');
      } else {
        instContainer.classList.add('hidden');
      }
    }

    // Highlight selected card
    document.querySelectorAll('.export-type-card').forEach(card => {
      const radio = card.querySelector('input[type="radio"]');
      if (radio && radio.checked) {
        card.classList.add('border-emerald-500', 'bg-emerald-50/50');
        card.classList.remove('border-slate-200');
      } else {
        card.classList.remove('border-emerald-500', 'bg-emerald-50/50');
        card.classList.add('border-slate-200');
      }
    });

    const schools = filterSchoolsForExport(filters);
    const previewText = document.getElementById('export-preview-text');
    if (!previewText) return;

    if (filters.type === 'progress') {
      previewText.innerHTML = `จะส่งออกตารางติดตามความคืบหน้า <strong>${schools.length} สถานศึกษา</strong>`;
    } else if (filters.type === 'ef9') {
      previewText.innerHTML = `จะส่งออกคะแนนสมรรถนะ EF 9 ด้าน <strong>${schools.length} สถานศึกษา</strong>`;
    } else if (filters.type === 'group') {
      const allGroups = [...new Set((window.NAN1_SCHOOLS || []).map(s => s.group))];
      const matchGroups = filters.group === 'all' ? allGroups : [filters.group];
      previewText.innerHTML = `จะส่งออกสรุปภาพรวมความคืบหน้ารายกลุ่ม <strong>${matchGroups.length} กลุ่มโรงเรียน</strong> (${schools.length} โรงเรียน)`;
    } else {
      const subs = filterSubmissionsForExport(filters);
      previewText.innerHTML = `จะส่งออกข้อมูลการประเมิน <strong>${subs.length} รายการ</strong> (${new Set(subs.map(s => s.schoolId)).size} โรงเรียน)`;
    }
  }

  // Open Export Progress Modal
  function openExportProgressModal() {
    const existing = document.getElementById('export-progress-modal');
    if (existing) existing.remove();

    const schools = window.NAN1_SCHOOLS || [];
    const groups = [...new Set(schools.map(s => s.group))].sort();
    const districts = [...new Set(schools.map(s => s.district))].sort();

    // Default to currently selected group / status in admin table if open
    const currentTableGroup = (document.getElementById('admin-table-group-filter') || {}).value || 'all';
    const currentTableStatus = (document.getElementById('admin-table-status-filter') || {}).value || 'all';

    const modal = document.createElement('div');
    modal.id = 'export-progress-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-fade-in';
    modal.innerHTML = `
      <div class="bg-white rounded-3xl max-w-2xl w-full p-6 md:p-8 shadow-2xl border border-slate-200 text-slate-800 space-y-6 max-h-[92vh] overflow-y-auto">
        
        <!-- Header -->
        <div class="flex items-center justify-between pb-4 border-b border-slate-100">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-bold shadow-inner">
              <i class="fas fa-file-csv"></i>
            </div>
            <div>
              <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 uppercase tracking-wider">ระบบส่งออกข้อมูลสารสนเทศ</span>
              <h3 class="text-lg md:text-xl font-bold text-slate-900 mt-0.5">Export ติดตามความคืบหน้า (CSV / Excel)</h3>
            </div>
          </div>
          <button onclick="document.getElementById('export-progress-modal').remove()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center text-sm transition">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- 1. เลือกประเภทรายงาน (Report Type Selection) -->
        <div class="space-y-2.5">
          <label class="block text-xs font-bold text-slate-800">
            <i class="fas fa-layer-group text-blue-600 mr-1"></i> 1. เลือกประเภทชุดข้อมูลที่ต้องการส่งออก (Export Data Type):
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            
            <label class="export-type-card p-3 rounded-2xl border-2 border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 cursor-pointer flex items-start gap-2.5 transition">
              <input type="radio" name="export-report-type" value="progress" checked onchange="window.EF_APP.updateExportProgressPreview()" class="mt-1 text-emerald-600 focus:ring-emerald-500">
              <div class="min-w-0">
                <strong class="text-xs font-bold text-slate-900 block">📊 ตารางติดตามความคืบหน้า 145 โรงเรียน</strong>
                <p class="text-[11px] text-slate-500 mt-0.5">สถิติ 5 ชุด (ศน.|รร.|ครู|นร.|ผปค.), ยอดส่งรวม, x̄, สถานะความคืบหน้า</p>
              </div>
            </label>

            <label class="export-type-card p-3 rounded-2xl border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer flex items-start gap-2.5 transition">
              <input type="radio" name="export-report-type" value="ef9" onchange="window.EF_APP.updateExportProgressPreview()" class="mt-1 text-emerald-600 focus:ring-emerald-500">
              <div class="min-w-0">
                <strong class="text-xs font-bold text-slate-900 block">🧠 ความคืบหน้า + สมรรถนะ EF 9 ด้าน</strong>
                <p class="text-[11px] text-slate-500 mt-0.5">ผลคะแนนเฉลี่ย 9 ด้าน (WM, Inhibitory, Shift, Focus ฯลฯ) รายโรงเรียน</p>
              </div>
            </label>

            <label class="export-type-card p-3 rounded-2xl border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer flex items-start gap-2.5 transition">
              <input type="radio" name="export-report-type" value="raw" onchange="window.EF_APP.updateExportProgressPreview()" class="mt-1 text-emerald-600 focus:ring-emerald-500">
              <div class="min-w-0">
                <strong class="text-xs font-bold text-slate-900 block">📑 ฐานข้อมูลรายการตอบประเมินทั้งหมด</strong>
                <p class="text-[11px] text-slate-500 mt-0.5">Raw Submissions ทุกรายการ พร้อมผู้ประเมิน, คะแนน, และวันที่</p>
              </div>
            </label>

            <label class="export-type-card p-3 rounded-2xl border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer flex items-start gap-2.5 transition">
              <input type="radio" name="export-report-type" value="group" onchange="window.EF_APP.updateExportProgressPreview()" class="mt-1 text-emerald-600 focus:ring-emerald-500">
              <div class="min-w-0">
                <strong class="text-xs font-bold text-slate-900 block">🏢 สรุปความคืบหน้ารายกลุ่มโรงเรียน (16 กลุ่ม)</strong>
                <p class="text-[11px] text-slate-500 mt-0.5">ร้อยละความสำเร็จ, โรงเรียนที่ส่งครบ, กำลังทำ, ยังไม่เริ่ม รายกลุ่ม</p>
              </div>
            </label>

            <label class="export-type-card p-3 rounded-2xl border-2 border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer flex items-start gap-2.5 sm:col-span-2 transition">
              <input type="radio" name="export-report-type" value="instrument" onchange="window.EF_APP.updateExportProgressPreview()" class="mt-1 text-emerald-600 focus:ring-emerald-500">
              <div class="min-w-0">
                <strong class="text-xs font-bold text-slate-900 block">📋 แยกเฉพาะชุดแบบประเมินรายชุด (Specific Instrument)</strong>
                <p class="text-[11px] text-slate-500 mt-0.5">ส่งออกเฉพาะชุดใดชุดหนึ่ง เช่น ศน., สถานศึกษา, ครูปฐมวัย, ครูประถม, นักเรียน หรือ ผู้ปกครอง</p>
              </div>
            </label>

          </div>
        </div>

        <!-- 2. ตัวกรองข้อมูล (Filter Options) -->
        <div class="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div class="text-xs font-bold text-slate-800 flex items-center justify-between">
            <span><i class="fas fa-filter text-amber-600 mr-1"></i> 2. กำหนดเงื่อนไขการกรองข้อมูล (Filters):</span>
            <button type="button" onclick="window.EF_APP.resetExportFilters()" class="text-[11px] text-blue-600 hover:underline font-normal">
              ล้างตัวกรองทั้งหมด
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-semibold text-slate-600 mb-1">กลุ่มโรงเรียน (School Group)</label>
              <select id="export-filter-group" onchange="window.EF_APP.updateExportProgressPreview()" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none">
                <option value="all">ทุกกลุ่มโรงเรียน (16 กลุ่ม)</option>
                ${groups.map(g => `<option value="${g}" ${g === currentTableGroup ? 'selected' : ''}>${g}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[11px] font-semibold text-slate-600 mb-1">อำเภอ (District)</label>
              <select id="export-filter-district" onchange="window.EF_APP.updateExportProgressPreview()" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none">
                <option value="all">ทุกอำเภอ</option>
                ${districts.map(d => `<option value="${d}">อ.${d}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[11px] font-semibold text-slate-600 mb-1">สถานะความคืบหน้า (Progress Status)</label>
              <select id="export-filter-status" onchange="window.EF_APP.updateExportProgressPreview()" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none">
                <option value="all">ทุกสถานะความคืบหน้า</option>
                <option value="completed" ${currentTableStatus === 'completed' ? 'selected' : ''}>✓ ครบเกณฑ์สถานศึกษา (รร.+ครู+นร.+ผปค. ≥1)</option>
                <option value="partial" ${currentTableStatus === 'partial' ? 'selected' : ''}>⏳ กำลังดำเนินการ (1-3 ชุด)</option>
                <option value="none" ${currentTableStatus === 'none' ? 'selected' : ''}>⭕ ยังไม่เริ่มส่ง (0 ชุด)</option>
                <option value="has_sup" ${currentTableStatus === 'has_sup' ? 'selected' : ''}>มีบันทึกศึกษานิเทศก์ (ศน.)</option>
                <option value="has_sch" ${currentTableStatus === 'has_sch' ? 'selected' : ''}>มีบันทึกสถานศึกษา (รร.)</option>
                <option value="has_tch" ${currentTableStatus === 'has_tch' ? 'selected' : ''}>มีบันทึกครูผู้สอน</option>
                <option value="has_stu" ${currentTableStatus === 'has_stu' ? 'selected' : ''}>มีบันทึกนักเรียน</option>
                <option value="has_par" ${currentTableStatus === 'has_par' ? 'selected' : ''}>มีบันทึกผู้ปกครอง (≥ 1 คน)</option>
                <option value="missing_sch" ${currentTableStatus === 'missing_sch' ? 'selected' : ''}>ขาดชุดสถานศึกษา</option>
                <option value="missing_tch" ${currentTableStatus === 'missing_tch' ? 'selected' : ''}>ขาดชุดครูผู้สอน</option>
                <option value="missing_stu" ${currentTableStatus === 'missing_stu' ? 'selected' : ''}>ขาดชุดนักเรียน</option>
                <option value="missing_par" ${currentTableStatus === 'missing_par' ? 'selected' : ''}>ขาดชุดผู้ปกครอง (&lt; 1 คน)</option>
              </select>
            </div>

            <div id="export-instrument-container" class="hidden">
              <label class="block text-[11px] font-semibold text-slate-600 mb-1">เจาะจงชุดแบบประเมิน (Instrument Form)</label>
              <select id="export-filter-instrument" onchange="window.EF_APP.updateExportProgressPreview()" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500 outline-none">
                <option value="all">ทุกชุดแบบประเมิน</option>
                <option value="supervisor">1. แบบประเมินสำหรับศึกษานิเทศก์ (ศน.)</option>
                <option value="school">2. แบบประเมินสถานศึกษา (รร.)</option>
                <option value="teacher_early">3.1 แบบนิเทศครูปฐมวัย (อ.1-3)</option>
                <option value="teacher_primary">3.2 แบบนิเทศครูประถม (สุขศึกษา/พลฯ)</option>
                <option value="teacher">3. แบบนิเทศครูผู้สอน (รวมทุกระดับ)</option>
                <option value="student_early">4.1 แบบประเมินเด็กปฐมวัย (ครู)</option>
                <option value="student_primary">4.2 แบบประเมินเด็กประถม (ครู)</option>
                <option value="parent_early">5.1 แบบประเมินผู้ปกครองปฐมวัย</option>
                <option value="parent_primary">5.2 แบบประเมินผู้ปกครองประถม</option>
              </select>
            </div>
          </div>
        </div>

        <!-- 3. สรุปพรีวิวยอดจำนวนข้อมูลที่จะส่งออก (Live Preview) -->
        <div id="export-preview-box" class="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <i class="fas fa-check-circle text-emerald-600 text-sm"></i>
            <span id="export-preview-text" class="font-medium text-emerald-900">กำลังคำนวณจำนวนข้อมูลที่จะส่งออก...</span>
          </div>
          <span class="text-[10px] font-mono text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full font-bold">UTF-8 Thai Ready</span>
        </div>

        <!-- Actions -->
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div class="text-[11px] text-slate-500 flex items-center gap-1.5">
            <i class="fas fa-info-circle text-blue-500"></i>
            <span>ไฟล์ CSV เข้ารหัส UTF-8 BOM เปิดใน MS Excel ภาษาไทยถูกต้อง 100%</span>
          </div>

          <div class="flex items-center gap-2 w-full sm:w-auto">
            <button type="button" onclick="document.getElementById('export-progress-modal').remove()" class="w-1/3 sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition">
              ปิด
            </button>
            <button type="button" onclick="window.EF_APP.executeExportProgress('csv')" class="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 active:scale-95">
              <i class="fas fa-file-csv text-base"></i>
              <span>ดาวน์โหลด CSV</span>
            </button>
            <button type="button" onclick="window.EF_APP.executeExportProgress('xlsx')" class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition flex items-center justify-center gap-2 active:scale-95">
              <i class="fas fa-file-excel text-base"></i>
              <span>ดาวน์โหลด Excel</span>
            </button>
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
    updateExportProgressPreview();
  }

  // Execute Export Process (CSV / XLSX)
  function executeExportProgress(format = 'csv') {
    const filters = getSelectedExportFilters();
    const subs = state.submissions || [];
    const schools = filterSchoolsForExport(filters);
    const dateStr = getThaiDateISO();

    let exportRows = [];
    let baseFileName = '';
    let sheetName = '';

    if (filters.type === 'progress') {
      baseFileName = `EF69_ติดตามความคืบหน้า145สถานศึกษา_สพป_น่าน1_${dateStr}`;
      sheetName = 'School_Progress_Tracking';

      exportRows = schools.map((sch, idx) => {
        const schSubs = subs.filter(sub => sub.schoolId === sch.id);
        const sSup = schSubs.filter(x => x.type === 'supervisor');
        const sSch = schSubs.filter(x => x.type === 'school');
        const sTch = schSubs.filter(x => x.type === 'teacher');
        const tchEarly = sTch.filter(x => x.teachingStage === 'early' || (x.gradeLevel && x.gradeLevel.startsWith('a'))).length;
        const tchPrimary = sTch.length - tchEarly;

        const sStu = schSubs.filter(x => x.type && x.type.startsWith('student_'));
        const stuEarly = sStu.filter(x => x.type === 'student_early').length;
        const stuPrimary = sStu.filter(x => x.type === 'student_primary').length;

        const sPar = schSubs.filter(x => x.type && x.type.startsWith('parent_'));
        const parEarly = sPar.filter(x => x.type === 'parent_early').length;
        const parPrimary = sPar.filter(x => x.type === 'parent_primary').length;

        let schoolSetsCompleted = 0;
        if (sSch.length > 0) schoolSetsCompleted++;
        if (sTch.length > 0) schoolSetsCompleted++;
        if (sStu.length > 0) schoolSetsCompleted++;
        if (sPar.length >= 1) schoolSetsCompleted++;

        const isCompleted = schoolSetsCompleted === 4;
        const avgScore = schSubs.length > 0 ? (schSubs.reduce((a, b) => a + (Number(b.scoreAvg) || 0), 0) / schSubs.length).toFixed(2) : '-';
        const quality = avgScore !== '-' ? (Number(avgScore) >= 2.5 ? 'ระดับดีมาก / ก้าวหน้า' : Number(avgScore) >= 1.8 ? 'ระดับพอใช้ / กำลังพัฒนา' : 'ระดับควรหนุนเสริม') : 'ยังไม่มีข้อมูล';
        const statusText = isCompleted ? (sSup.length > 0 ? 'ครบเกณฑ์ 4 ชุด (+ศน.นิเทศแล้ว)' : 'ครบเกณฑ์ 4 ชุดหลัก') : (schoolSetsCompleted > 0 || sSup.length > 0 ? `กำลังดำเนินการ (${schoolSetsCompleted}/4 ชุด)` : 'ยังไม่เริ่มส่ง (0 ชุด)');

        return {
          'ลำดับ': idx + 1,
          'รหัสสถานศึกษา': sch.id,
          'ชื่อสถานศึกษา': sch.name,
          'กลุ่มโรงเรียน': sch.group,
          'อำเภอ': sch.district,
          'ขนาดโรงเรียน': sch.schoolSize,
          'นักเรียนรวม (คน)': sch.totalStudents,
          'นักเรียนปฐมวัย (คน)': sch.earlyStudents,
          'นักเรียนประถม (คน)': sch.primaryStudents,
          'นักเรียนมัธยม (คน)': sch.secondaryStudents,
          'ชุดที่ 1 ศน. (ชุด)': sSup.length,
          'ชุดที่ 2 สถานศึกษา (ชุด)': sSch.length,
          'ชุดที่ 3 รวมครู (คน)': sTch.length,
          'ชุดที่ 3.1 ครูปฐมวัย (คน)': tchEarly,
          'ชุดที่ 3.2 ครูประถม (คน)': tchPrimary,
          'ชุดที่ 4 รวมนักเรียน (คน)': sStu.length,
          'ชุดที่ 4.1 เด็กปฐมวัย (คน)': stuEarly,
          'ชุดที่ 4.2 เด็กประถม (คน)': stuPrimary,
          'ชุดที่ 5 รวมผู้ปกครอง (คน)': sPar.length,
          'ชุดที่ 5.1 ผปค.ปฐมวัย (คน)': parEarly,
          'ชุดที่ 5.2 ผปค.ประถม (คน)': parPrimary,
          'รวมส่งทั้งหมด (ชุด)': schSubs.length,
          'คะแนนเฉลี่ยรวม (x̄)': avgScore,
          'สถานะความคืบหน้า': statusText,
          'ระดับคุณภาพ': quality
        };
      });

    } else if (filters.type === 'ef9') {
      baseFileName = `EF69_สมรรถนะEF9ด้านรายโรงเรียน_สพป_น่าน1_${dateStr}`;
      sheetName = 'EF_9_Domains_By_School';

      exportRows = schools.map((sch, idx) => {
        const schSubs = subs.filter(sub => sub.schoolId === sch.id);
        const domainKeys = ['wm', 'ic', 'sh', 'fo', 'ec', 'sm', 'in', 'po', 'gp'];
        const scores = {};

        domainKeys.forEach(k => {
          const matching = [];
          schSubs.forEach(sub => {
            if (sub.domainScores && typeof sub.domainScores[k] === 'number') {
              matching.push(sub.domainScores[k]);
            } else if (sub.answers && typeof sub.answers === 'object') {
              const keys = Object.keys(sub.answers).filter(q => q.includes(`_${k}_`) || q.startsWith(`${k}_`));
              const vals = keys.map(q => Number(sub.answers[q])).filter(v => !isNaN(v));
              if (vals.length > 0) matching.push(vals.reduce((a, b) => a + b, 0) / vals.length);
            } else if (typeof sub.scoreAvg === 'number' && sub.scoreAvg > 0) {
              matching.push(sub.scoreAvg);
            }
          });
          scores[k] = matching.length > 0 ? (matching.reduce((a, b) => a + b, 0) / matching.length).toFixed(2) : '-';
        });

        const avgBasic = [scores.wm, scores.ic, scores.sh].filter(v => v !== '-').map(Number);
        const scoreBasic = avgBasic.length > 0 ? (avgBasic.reduce((a,b)=>a+b,0)/avgBasic.length).toFixed(2) : '-';

        const avgSelf = [scores.fo, scores.ec, scores.sm].filter(v => v !== '-').map(Number);
        const scoreSelf = avgSelf.length > 0 ? (avgSelf.reduce((a,b)=>a+b,0)/avgSelf.length).toFixed(2) : '-';

        const avgPractice = [scores.in, scores.po, scores.gp].filter(v => v !== '-').map(Number);
        const scorePractice = avgPractice.length > 0 ? (avgPractice.reduce((a,b)=>a+b,0)/avgPractice.length).toFixed(2) : '-';

        const allValid = Object.values(scores).filter(v => v !== '-').map(Number);
        const overallAvg = allValid.length > 0 ? (allValid.reduce((a,b)=>a+b,0)/allValid.length).toFixed(2) : '-';
        const quality = overallAvg !== '-' ? (Number(overallAvg) >= 2.5 ? 'ระดับดีมาก / ก้าวหน้า' : Number(overallAvg) >= 1.8 ? 'ระดับพอใช้ / กำลังพัฒนา' : 'ระดับควรหนุนเสริม') : 'ยังไม่มีข้อมูล';

        return {
          'ลำดับ': idx + 1,
          'รหัสสถานศึกษา': sch.id,
          'ชื่อสถานศึกษา': sch.name,
          'กลุ่มโรงเรียน': sch.group,
          'อำเภอ': sch.district,
          'รวมส่งประเมิน (ชุด)': schSubs.length,
          '1.ความจำใช้งาน (WM)': scores.wm,
          '2.ยั้งคิดไตร่ตรอง (Inhibitory)': scores.ic,
          '3.ยืดหยุ่นความคิด (Shift)': scores.sh,
          'กลุ่มที่ 1 : ทักษะพื้นฐาน (x̄)': scoreBasic,
          '4.จดจ่อใส่ใจ (Focus)': scores.fo,
          '5.ควบคุมอารมณ์ (Emotion)': scores.ec,
          '6.ติดตามประเมินตนเอง (Monitoring)': scores.sm,
          'กลุ่มที่ 2 : ทักษะกำกับตนเอง (x̄)': scoreSelf,
          '7.ริเริ่มลงมือทำ (Initiating)': scores.in,
          '8.วางแผนจัดระบบ (Planning)': scores.po,
          '9.มุ่งเป้าหมาย (Goal)': scores.gp,
          'กลุ่มที่ 3 : ทักษะปฏิบัติ (x̄)': scorePractice,
          'คะแนนเฉลี่ยรวม 9 ด้าน (x̄)': overallAvg,
          'ระดับคุณภาพรวม': quality
        };
      });

    } else if (filters.type === 'group') {
      baseFileName = `EF69_สรุปความคืบหน้ารายกลุ่มโรงเรียน16กลุ่ม_สพป_น่าน1_${dateStr}`;
      sheetName = 'Group_Progress_Summary';

      const allGroups = [...new Set((window.NAN1_SCHOOLS || []).map(s => s.group))].sort();
      const targetGroups = filters.group === 'all' ? allGroups : [filters.group];

      exportRows = targetGroups.map((grpName, idx) => {
        const grpSchools = (window.NAN1_SCHOOLS || []).filter(s => s.group === grpName && (filters.district === 'all' || s.district === filters.district));
        if (grpSchools.length === 0) return null;

        const grpDistrict = grpSchools[0].district;
        let completedCount = 0;
        let partialCount = 0;
        let noneCount = 0;
        let grpSubs = [];

        grpSchools.forEach(sch => {
          const schSubs = subs.filter(sub => sub.schoolId === sch.id);
          grpSubs.push(...schSubs);
          const sSup = schSubs.filter(x => x.type === 'supervisor');
          const sSch = schSubs.filter(x => x.type === 'school');
          const sTch = schSubs.filter(x => x.type === 'teacher');
          const sStu = schSubs.filter(x => x.type && x.type.startsWith('student_'));
          const sPar = schSubs.filter(x => x.type && x.type.startsWith('parent_'));

          let setsDone = 0;
          if (sSch.length > 0) setsDone++;
          if (sTch.length > 0) setsDone++;
          if (sStu.length > 0) setsDone++;
          if (sPar.length >= 1) setsDone++;

          if (setsDone === 4) completedCount++;
          else if (setsDone > 0 || sSup.length > 0) partialCount++;
          else noneCount++;
        });

        const totalSch = grpSchools.length;
        const pctComplete = totalSch > 0 ? ((completedCount / totalSch) * 100).toFixed(1) : '0.0';
        const grpAvg = grpSubs.length > 0 ? (grpSubs.reduce((a, b) => a + (Number(b.scoreAvg) || 0), 0) / grpSubs.length).toFixed(2) : '-';
        const quality = grpAvg !== '-' ? (Number(grpAvg) >= 2.5 ? 'ระดับดีมาก / ก้าวหน้า' : Number(grpAvg) >= 1.8 ? 'ระดับพอใช้ / กำลังพัฒนา' : 'ระดับควรหนุนเสริม') : 'ยังไม่มีข้อมูล';

        return {
          'ลำดับ': idx + 1,
          'กลุ่มโรงเรียน': grpName,
          'อำเภอ': grpDistrict,
          'จำนวนสถานศึกษาทั้งหมด (แห่ง)': totalSch,
          'ส่งครบเกณฑ์ 4 ชุด (แห่ง)': completedCount,
          'กำลังดำเนินการ (แห่ง)': partialCount,
          'ยังไม่เริ่มส่ง (แห่ง)': noneCount,
          'ร้อยละความสำเร็จ (%)': pctComplete + '%',
          'ยอดส่งประเมินรวม (ชุด)': grpSubs.length,
          'คะแนนเฉลี่ยกลุ่มโรงเรียน (x̄)': grpAvg,
          'ระดับคุณภาพกลุ่ม': quality
        };
      }).filter(Boolean);

    } else {
      // Raw Submissions or Specific Instrument
      const targetSubs = filterSubmissionsForExport(filters);
      baseFileName = filters.type === 'instrument' ? `EF69_รายการประเมินชุด_${filters.instrument}_สพป_น่าน1_${dateStr}` : `EF69_ฐานข้อมูลรายการประเมินทั้งหมด_สพป_น่าน1_${dateStr}`;
      sheetName = 'Raw_Submissions';

      exportRows = targetSubs.map((s, idx) => ({
        'ลำดับ': idx + 1,
        'รหัสการส่ง (Submission ID)': s.id,
        'ประเภทแบบประเมิน': s.typeName,
        'ช่วงชั้น': s.teachingStage === 'early' ? 'ปฐมวัย' : s.teachingStage === 'primary' ? 'ประถมศึกษา' : (s.type.includes('early') ? 'ปฐมวัย' : s.type.includes('primary') ? 'ประถมศึกษา' : '-'),
        'ระดับชั้น': s.gradeLevelName || s.gradeLevel || '-',
        'รหัสสถานศึกษา': s.schoolId,
        'ชื่อสถานศึกษา': s.schoolName,
        'กลุ่มโรงเรียน': s.schoolGroup,
        'อำเภอ': s.district,
        'ผู้ประเมิน': s.evaluator,
        'ผู้รับการประเมิน / ชื่อนักเรียน': s.studentName || s.recipientName || '-',
        'คะแนนรวม': s.scoreTotal,
        'คะแนนเฉลี่ย (x̄)': (Number(s.scoreAvg) || 0).toFixed(2),
        'ระดับคุณภาพ': s.qualityLevel,
        'วันที่ประเมิน': s.date ? formatThaiDate(s.date) : '-',
        'วันที่ประเมิน (ISO)': s.date || '-',
        'เวลาที่บันทึก (เวลาไทย)': s.submittedAt ? formatThaiDateTime(s.submittedAt) : '-',
        'เอกสารแนบ/ภาพถ่าย': (s.attachment && s.attachment.name) ? s.attachment.name : (s.attachmentUrl ? 'มีไฟล์แนบ' : '-'),
        'ลิงก์เปิดดู Google Drive': (s.attachment && s.attachment.url) ? s.attachment.url : (s.attachmentUrl || '-')
      }));
    }

    if (exportRows.length === 0) {
      showToast('ไม่พบข้อมูลตามเงื่อนไขที่เลือกสำหรับการส่งออก', 'warning');
      return;
    }

    // Export as CSV
    if (format === 'csv') {
      const csvContent = convertJsonToCSV(exportRows);
      downloadCSV(`${baseFileName}.csv`, csvContent);
    } else {
      // Export as Excel XLSX
      if (!window.XLSX) {
        showToast('กำลังโหลดโมดูล Excel...', 'info');
        return;
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
      XLSX.writeFile(wb, `${baseFileName}.xlsx`);
      showToast(`ดาวน์โหลดไฟล์ Excel เรียบร้อยแล้ว (${baseFileName}.xlsx)`, 'success');
    }

    const modal = document.getElementById('export-progress-modal');
    if (modal) modal.remove();
  }

  // Legacy fallback exportToExcel
  function exportToExcel() {
    openExportProgressModal();
  }

  // Safety Confirmation Modal for Resetting/Clearing All System Data (ป้องกันข้อผิดพลาดในการเก็บข้อมูลจริง)
  function openClearDataSafetyModal() {
    const existing = document.getElementById('clear-data-safety-modal');
    if (existing) existing.remove();

    const currentCount = (state.submissions || []).length;
    const uniqueSchoolsCount = new Set((state.submissions || []).map(s => s.schoolId)).size;

    const modal = document.createElement('div');
    modal.id = 'clear-data-safety-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in';
    modal.innerHTML = `
      <div class="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border-2 border-rose-200 text-slate-800 space-y-6">
        
        <!-- Header Warning -->
        <div class="flex items-center gap-4 pb-4 border-b border-rose-100">
          <div class="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center text-2xl font-bold shrink-0 shadow-inner">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <div>
            <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 uppercase tracking-wider">ระบบความปลอดภัยข้อมูลจริง</span>
            <h3 class="text-xl font-bold text-slate-900 mt-1">ยืนยันการล้างข้อมูลระบบทั้งหมด?</h3>
          </div>
        </div>

        <!-- Warning details & current data info -->
        <div class="space-y-3 text-xs leading-relaxed text-slate-600">
          <div class="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 space-y-2">
            <p class="font-bold flex items-center gap-1.5 text-rose-800 text-sm">
              <i class="fas fa-shield-alt"></i> คำเตือนสำคัญสำหรับการเก็บข้อมูลจริง:
            </p>
            <p>
              การกระทำนี้จะ<strong>ลบข้อมูลผลการประเมินทั้งหมด</strong>ออกจากระบบและหน่วยความจำของบราวเซอร์อย่างถาวร โดยไม่สามารถกู้คืนได้
            </p>
            <div class="pt-2 border-t border-rose-200/80 flex items-center justify-between text-xs font-semibold text-rose-950">
              <span>ข้อมูลที่จะถูกลบขณะนี้:</span>
              <span class="bg-white/90 px-2.5 py-0.5 rounded-lg border border-rose-300 font-bold text-rose-700">${currentCount} ชุด (${uniqueSchoolsCount} โรงเรียน)</span>
            </div>
          </div>

          <!-- Backup suggestion -->
          <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div class="text-[11px] text-slate-600">
              <strong>ข้อแนะนำ:</strong> หากต้องการเก็บสำรองข้อมูลไว้ก่อน ให้ดาวน์โหลดไฟล์ Excel
            </div>
            <button type="button" onclick="window.EF_APP.exportToExcel()" class="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-sm flex items-center gap-1 transition">
              <i class="fas fa-file-excel"></i> สำรอง Excel
            </button>
          </div>

          <!-- Verification Input Step -->
          <div class="space-y-1.5 pt-2">
            <label class="block font-bold text-slate-700 text-xs">
              เพื่อยืนยันความปลอดภัย โปรดพิมพ์คำว่า <span class="text-rose-600 font-mono font-black bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 select-all">ยืนยันล้างข้อมูล</span> หรือ <span class="text-rose-600 font-mono font-black bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 select-all">CONFIRM</span> ในช่องด้านล่าง:
            </label>
            <input type="text" id="clear-confirm-input" placeholder="พิมพ์ข้อความยืนยันที่นี่..." autocomplete="off" class="w-full px-3.5 py-2.5 rounded-xl border-2 border-slate-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-200 text-xs text-slate-800 font-medium transition outline-none">
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
          <button type="button" onclick="document.getElementById('clear-data-safety-modal').remove()" class="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition">
            ยกเลิก / ไม่ล้างข้อมูล
          </button>
          <button type="button" id="clear-confirm-btn" disabled class="px-5 py-2.5 rounded-xl bg-slate-200 text-slate-400 text-xs font-bold transition flex items-center gap-1.5 cursor-not-allowed">
            <i class="fas fa-trash-alt"></i>
            <span>ยืนยันล้างข้อมูลระบบ</span>
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    const input = document.getElementById('clear-confirm-input');
    const btn = document.getElementById('clear-confirm-btn');

    if (input && btn) {
      input.focus();
      input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        if (val === 'ยืนยันล้างข้อมูล' || val === 'confirm' || val === 'delete') {
          btn.disabled = false;
          btn.className = 'px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-500/20 transition flex items-center gap-1.5 cursor-pointer animate-pulse';
        } else {
          btn.disabled = true;
          btn.className = 'px-5 py-2.5 rounded-xl bg-slate-200 text-slate-400 text-xs font-bold transition flex items-center gap-1.5 cursor-not-allowed';
        }
      });

      btn.addEventListener('click', () => {
        const val = input.value.trim().toLowerCase();
        if (val === 'ยืนยันล้างข้อมูล' || val === 'confirm' || val === 'delete') {
          // Execute reset
          state.submissions = [];
          try {
            localStorage.setItem(STORAGE_KEY_SUBMISSIONS, JSON.stringify([]));
            localStorage.removeItem('ef69_obec_config');
          } catch (e) {
            console.warn(e);
          }
          modal.remove();
          showToast('ล้างฐานข้อมูลระบบเรียบร้อยแล้ว (เริ่มต้นระบบที่ 0)', 'success');
          renderAdminView();
          renderHomeView();
        }
      });
    }
  }

  // Clear all submissions to start clean (Real Data Zero State)
  function clearDemoSubmissions() {
    openClearDataSafetyModal();
  }

  // Sync live data from Google Apps Script Web App (Manual trigger by user/admin)
  async function syncWithGoogleSheet() {
    return await fetchLiveSubmissions({ force: true, silent: false });
  }

  function copyLink(url) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('คัดลอกลิงก์เรียบร้อยแล้ว!', 'success');
      });
    } else {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      showToast('คัดลอกลิงก์เรียบร้อยแล้ว!', 'success');
    }
  }

  function printQrCard(title, formType, schoolName, group, targetUrl) {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Code Card - ${title} - ${schoolName}</title>
        <meta charset="utf-8">
        <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600;700&family=Sarabun:wght@400;600&display=swap" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
        <style>
          body { font-family: 'Sarabun', sans-serif; background: #f8fafc; padding: 40px; display: flex; justify-content: center; }
          .card { background: #fff; width: 420px; border: 2px solid #2563eb; border-radius: 20px; padding: 30px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
          .header-tag { font-family: 'Prompt'; font-size: 11px; font-weight: 700; background: #eff6ff; color: #1d4ed8; padding: 4px 12px; border-radius: 20px; display: inline-block; margin-bottom: 12px; }
          h2 { font-family: 'Prompt'; color: #0f172a; margin: 0 0 4px 0; font-size: 20px; }
          h3 { font-family: 'Prompt'; color: #1e40af; margin: 0 0 16px 0; font-size: 16px; }
          .qr-box { background: #f8fafc; padding: 15px; border-radius: 16px; display: inline-block; margin: 15px 0; border: 1px solid #e2e8f0; }
          .footer-note { font-size: 11px; color: #64748b; margin-top: 15px; }
          .btn-print { margin-top: 20px; padding: 10px 20px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; }
          @media print { .btn-print { display: none; } body { padding: 0; background: #fff; } .card { box-shadow: none; border: 1px solid #94a3b8; } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header-tag">โครงการส่งเสริมทักษะสมอง EF 69 • สพป.น่าน เขต 1</div>
          <h2>${title}</h2>
          <h3>${schoolName} (${group})</h3>
          <div class="qr-box" id="qrcode"></div>
          <p style="font-size: 13px; font-weight: 600; color: #334155; margin: 0;">สแกน QR Code ด้วยกล้องมือถือเพื่อทำแบบประเมิน</p>
          <div class="footer-note">สำนักงานเขตพื้นที่การศึกษาประถมศึกษาน่าน เขต 1</div>
          <button class="btn-print" onclick="window.print()">พิมพ์การ์ดนี้</button>
        </div>
        <script>
          new QRCode(document.getElementById("qrcode"), {
            text: "${targetUrl}",
            width: 180,
            height: 180,
            colorDark : "#0f172a",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
          });
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  // --- PUBLIC INTERFACE ---
  window.EF_APP = {
    navigate,
    openForm: (formType, schoolId) => {
      state.activeFormType = formType;
      if (schoolId && window.NAN1_SCHOOLS) {
        state.selectedSchool = window.NAN1_SCHOOLS.find(s => s.id === schoolId);
      }
      navigate('eval-form');
    },
    viewSchoolReport: (schoolId) => {
      if (schoolId && window.NAN1_SCHOOLS) {
        state.selectedSchool = window.NAN1_SCHOOLS.find(s => s.id === schoolId);
      }
      navigate('school-report');
    },
    openSchoolProgressModal,
    selectScore,
    handleFormSubmit,
    handleAdminLogin,
    adminLogout,
    openSettingsModal,
    saveGasUrl,
    exportToExcel,
    clearDemoSubmissions,
    openClearDataSafetyModal,
    fetchLiveSubmissions,
    syncWithGoogleSheet,
    copyLink,
    printQrCard,
    switchReportTab,
    switchObecLevel,
    saveObecConfig,
    copyTextToClipboard,
    copyAllObecData,
    onTeacherStageChange,
    openChangePasswordModal,
    saveNewAdminPassword,
    viewSubmissionDetail: openSubmissionDetailModal,
    deleteSubmission,
    getThaiDateISO,
    getThaiDateTimeISO,
    formatThaiDate,
    formatThaiDateTime,
    handleFileSelect,
    removeAttachment,
    openMediaLightbox,
    zoomLightbox,
    rotateLightbox,
    resetLightbox,
    copyMediaUrl,
    copyMediaEmbedCode,
    exportMediaManifestToExcel,
    openExportProgressModal,
    updateExportProgressPreview,
    resetExportFilters,
    executeExportProgress,
    downloadCSV,
    convertJsonToCSV,
    fetchDriveUploadedFiles,
    setMediaFilterType,
    setMediaFilterInstrument,
    setMediaFilterGroup,
    setMediaViewMode,
    onMediaSearchChange,
    renderAdminMediaGallery,
    getAllMediaItems
  };

})();
