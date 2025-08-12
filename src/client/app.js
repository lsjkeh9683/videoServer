// Global state
let allVideos = [];
let allTags = [];
let currentFilter = null;
let currentVideoId = null;
let uploadTags = []; // 업로드시 선택된 태그들
let selectedTagFilters = []; // 다중 태그 필터링용 선택된 태그들
let isTagCloudView = false; // 태그 클라우드 표시 여부
let editingTagId = null; // 편집 중인 태그 ID
let tagManagerData = []; // 태그 관리자에서 사용할 태그 데이터

// 필터 상태 관리
let filterState = {
  tags: [],
  resolution: [],
  durationMin: 0,
  durationMax: 14400, // 240분
  dateFilter: '',
  dateFrom: '',
  dateTo: ''
};

let isSidebarCollapsed = false; // 사이드바 상태

// DOM elements
const videoGrid = document.getElementById('videoGrid');
const loadingSpinner = document.getElementById('loadingSpinner');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const tagList = document.getElementById('tagList');
const videosTitle = document.getElementById('videosTitle');

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Video Server UI initialized');
  
  await loadVideos(); // 비디오를 먼저 로드
  await loadTags();   // 그 다음 태그를 로드 (비디오 카운트가 필요)
  setupEventListeners();
});

// ==================== API Functions ====================

async function apiCall(endpoint, options = {}) {
  try {
    const response = await fetch(`/api${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`API call failed: ${endpoint}`, error);
    showNotification(`Error: ${error.message}`, 'error');
    throw error;
  }
}

async function loadVideos() {
  try {
    showLoading(true);
    allVideos = await apiCall('/videos');
    renderVideos(allVideos);
    updateVideosTitle('All Videos', allVideos.length);
    console.log(`📺 Loaded ${allVideos.length} videos`);
  } catch (error) {
    console.error('Error loading videos:', error);
    showEmptyState();
  } finally {
    showLoading(false);
  }
}

async function loadTags() {
  try {
    allTags = await apiCall('/tags');
    await renderTags(); // renderTags를 비동기로 변경
    console.log(`🏷️  Loaded ${allTags.length} tags`);
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}

async function searchVideos(query, type = 'title') {
  try {
    showLoading(true);
    const results = await apiCall(`/videos/search?q=${encodeURIComponent(query)}&type=${type}`);
    renderVideos(results);
    // Don't update title here - let the caller handle it
    return results;
  } catch (error) {
    console.error('Error searching videos:', error);
    showEmptyState();
    return [];
  } finally {
    showLoading(false);
  }
}

// ==================== Render Functions ====================

function renderVideos(videos) {
  if (videos.length === 0) {
    videoGrid.innerHTML = ''; // Clear video grid content
    showEmptyState();
    return;
  }
  
  hideEmptyState();
  
  console.log(`🎬 Rendering ${videos.length} videos with preview info:`);
  videos.forEach(video => {
    console.log(`   📹 Video ${video.id}: ${video.title}`);
    console.log(`      Preview path: ${video.preview_path || 'None'}`);
    console.log(`      Thumbnail URL: ${video.thumbnail_url || 'None'}`);
  });
  
  videoGrid.innerHTML = videos.map(video => {
    const thumbnailUrls = getThumbnailUrl(video.filename);
    const thumbnailSrc = video.thumbnail_url || thumbnailUrls.jpg;
    const fallbackSrc = video.thumbnail_url ? thumbnailUrls.svg : thumbnailUrls.svg;
    
    return `
    <div class="video-card" data-video-id="${video.id}" onclick="openVideoModal(${video.id})">
      <div class="video-thumbnail">
        <img src="${thumbnailSrc}" 
             alt="${video.title}" 
             onerror="this.onerror=null; this.src='${fallbackSrc}'">
        
        ${video.preview_path ? `
          <div class="video-preview" onmouseenter="startPreview(this, ${video.id})" onmouseleave="stopPreview(this)">
            <video muted loop preload="none">
              <source src="/api/videos/${video.id}/preview" type="video/mp4">
            </video>
          </div>
        ` : `<!-- No preview available for video ${video.id} -->`}
        
        <button class="thumbnail-edit-btn" onclick="event.stopPropagation(); openThumbnailModal(${video.id})" title="Edit thumbnail">
          ✏️
        </button>
        
        <div class="video-duration">${formatDuration(video.duration)}</div>
      </div>
      
      <div class="video-info">
        <h3 class="video-title">${video.title}</h3>
        <div class="video-meta">
          <span>${formatFileSize(video.file_size)}</span>
          <span>${video.width}x${video.height}</span>
        </div>
        <div class="video-tags">
          ${video.tags.map((tag, index) => `
            <span class="video-tag" style="background-color: ${video.tag_colors[index] || '#007bff'}">${tag}</span>
          `).join('')}
        </div>
      </div>
    </div>
    `;
  }).join('');
}

async function renderTags() {
  if (allTags.length === 0) {
    tagList.innerHTML = '<p style="color: #aaa; text-align: center;">No tags available</p>';
    return;
  }
  
  if (isTagCloudView) {
    await renderTagCloud();
  } else {
    await renderTagList();
  }
}

async function renderTagList() {
  // 전체 비디오 개수 가져오기 (API 호출)
  let totalVideoCount = allVideos.length;
  if (totalVideoCount === 0) {
    try {
      const videos = await apiCall('/videos');
      totalVideoCount = videos.length;
    } catch (error) {
      console.error('Error getting video count:', error);
      totalVideoCount = 0;
    }
  }

  // "All" 태그를 맨 앞에 추가
  const allTag = `
    <div class="tag-item ${currentFilter === null ? 'selected' : ''}" 
         style="border-color: #6c757d; background-color: ${currentFilter === null ? '#6c757d' : 'var(--bg-card)'}; color: ${currentFilter === null ? 'white' : 'var(--text-primary)'}" 
         onclick="filterByTag(null)"
         data-tag-name="all">
      All 
      <span class="count">(${totalVideoCount})</span>
    </div>
  `;
  
  const tagElements = allTags.map(tag => `
    <div class="tag-item ${currentFilter === tag.name ? 'selected' : ''}" 
         style="border-color: ${tag.color}; background-color: ${currentFilter === tag.name ? tag.color : 'var(--bg-card)'}; color: ${currentFilter === tag.name ? 'white' : 'var(--text-primary)'}" 
         onclick="filterByTag('${tag.name}')"
         data-tag-name="${tag.name}">
      ${tag.name} 
      <span class="count">(${tag.video_count})</span>
    </div>
  `).join('');
  
  tagList.innerHTML = allTag + tagElements;
}

async function renderTagCloud() {
  const tagCloud = document.getElementById('tagCloud');
  
  // 전체 비디오 개수 가져오기
  let totalVideoCount = allVideos.length;
  if (totalVideoCount === 0) {
    try {
      const videos = await apiCall('/videos');
      totalVideoCount = videos.length;
    } catch (error) {
      console.error('Error getting video count:', error);
      totalVideoCount = 0;
    }
  }
  
  // 태그를 카테고리별로 분류
  const categorizedTags = categorizeTags(allTags);
  
  // "All" 태그 추가
  const allTag = `
    <div class="tag-item ${selectedTagFilters.length === 0 ? 'selected' : ''}" 
         style="border-color: #6c757d; background-color: ${selectedTagFilters.length === 0 ? '#6c757d' : 'var(--bg-card)'}; color: ${selectedTagFilters.length === 0 ? 'white' : 'var(--text-primary)'}"
         onclick="filterByTag(null)"
         data-tag-name="all">
      All 
      <span class="count">(${totalVideoCount})</span>
    </div>
  `;
  
  const cloudElements = categorizedTags.map(tag => {
    const isActive = selectedTagFilters.includes(tag.name);
    return `
      <div class="tag-item ${isActive ? 'selected' : ''} category-${tag.category}" 
           style="border-color: ${tag.color}; background-color: ${isActive ? tag.color : 'var(--bg-card)'}; color: ${isActive ? 'white' : 'var(--text-primary)'}"
           onclick="filterByTag('${tag.name}')"
           data-tag-name="${tag.name}">
        ${tag.name} 
        <span class="count">(${tag.video_count})</span>
      </div>
    `;
  }).join('');
  
  tagCloud.innerHTML = allTag + cloudElements;
}

function categorizeTags(tags) {
  const regionTags = ['KOREA', 'JAPAN', 'WESTERN'];
  const genreTags = ['Animation', 'Comedy', 'Drama', 'Action', 'Horror', 'Romance', 'Thriller', 'SF', 'Documentary'];
  
  return tags.map(tag => {
    let category = 'custom';
    if (regionTags.includes(tag.name)) {
      category = 'region';
    } else if (genreTags.some(genre => tag.name.toLowerCase().includes(genre.toLowerCase()))) {
      category = 'genre';
    }
    
    return {
      ...tag,
      category
    };
  });
}

function toggleTagCloudView() {
  isTagCloudView = !isTagCloudView;
  
  const tagList = document.getElementById('tagList');
  const tagCloud = document.getElementById('tagCloud');
  const toggleBtn = document.getElementById('toggleTagCloudBtn');
  
  if (isTagCloudView) {
    tagList.style.display = 'none';
    tagCloud.style.display = 'flex';
    toggleBtn.textContent = 'Tag List';
    renderTagCloud();
  } else {
    tagList.style.display = 'flex';
    tagCloud.style.display = 'none';
    toggleBtn.textContent = 'Tag Cloud';
    renderTagList();
  }
}

// ==================== Event Listeners ====================

function setupEventListeners() {
  // Search - 버튼 클릭 방식으로 변경
  document.getElementById('searchBtn').addEventListener('click', handleSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  });
  
  // 자동완성 기능
  searchInput.addEventListener('input', debounce(handleAutoComplete, 300));
  
  // 자동완성 외부 클릭 시 숨김
  document.addEventListener('click', (e) => {
    if (!searchInput.parentElement.contains(e.target)) {
      hideAutoComplete();
    }
  });
  
  // Upload
  document.getElementById('uploadBtn').addEventListener('click', () => openModal('uploadModal'));
  setupUploadHandlers();
  
  // Scan
  document.getElementById('scanBtn').addEventListener('click', () => openModal('scanModal'));
  setupScanHandlers();
  
  // New tag
  document.getElementById('newTagBtn').addEventListener('click', () => openModal('newTagModal'));
  setupNewTagHandlers();
  
  // Tag Cloud toggle
  document.getElementById('toggleTagCloudBtn').addEventListener('click', toggleTagCloudView);
  
  // Tag Manager
  document.getElementById('manageTagsBtn').addEventListener('click', () => openTagManager());
  
  // Filter Sidebar
  setupFilterHandlers();
  
  // Thumbnail selection
  document.getElementById('saveThumbnailBtn').addEventListener('click', saveThumbnailSelection);
  
  // Video tag management
  setupVideoTagHandlers();
  
  // Step navigation
  setupStepNavigationListeners();
  
  // Modal close handlers
  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal.id);
    });
  });
  
  // Close modals on background click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
  });
}

function setupUploadHandlers() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  
  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', handleDragOver);
  uploadArea.addEventListener('drop', handleDrop);
  fileInput.addEventListener('change', handleFileSelect);
}

function setupStepNavigationListeners() {
  // Step 1 -> 2: File to Tags
  document.getElementById('proceedToTagsBtn')?.addEventListener('click', proceedToTags);
  
  // Step 2 navigation
  document.getElementById('backToFileBtn')?.addEventListener('click', backToFileSelection);
  document.getElementById('proceedToThumbnailBtn')?.addEventListener('click', proceedToThumbnailSelection);
  
  // Step 3 navigation  
  document.getElementById('backToTagsBtn')?.addEventListener('click', backToTags);
  document.getElementById('proceedToFinalBtn')?.addEventListener('click', proceedToFinal);
  
  // Step 4 navigation
  document.getElementById('backToThumbnailBtn')?.addEventListener('click', backToThumbnails);
  document.getElementById('finalUploadBtn')?.addEventListener('click', executeUpload);
  
  // 업로드 태그 관련 핸들러
  document.getElementById('addUploadTagBtn').addEventListener('click', addUploadTag);
  document.getElementById('newUploadTagInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addUploadTag();
    }
  });
}

function setupScanHandlers() {
  document.getElementById('startScanBtn').addEventListener('click', handleDirectoryScan);
}

function setupNewTagHandlers() {
  document.getElementById('createTagBtn').addEventListener('click', handleCreateTag);
}

function setupVideoTagHandlers() {
  // Add tag to video
  document.getElementById('addVideoTagBtn')?.addEventListener('click', handleAddVideoTag);
  
  // Enter key support for adding video tags
  document.getElementById('newVideoTagInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddVideoTag();
    }
  });
}

// ==================== Handler Functions ====================

async function handleAutoComplete() {
  const query = searchInput.value.trim();
  if (!query || query.length < 2) {
    hideAutoComplete();
    return;
  }
  
  try {
    const response = await apiCall(`/search/autocomplete?q=${encodeURIComponent(query)}`);
    showAutoComplete(response.suggestions || []);
  } catch (error) {
    console.error('Autocomplete error:', error);
    hideAutoComplete();
  }
}

function showAutoComplete(suggestions) {
  let autoCompleteDiv = document.getElementById('autocomplete');
  if (!autoCompleteDiv) {
    autoCompleteDiv = document.createElement('div');
    autoCompleteDiv.id = 'autocomplete';
    autoCompleteDiv.className = 'autocomplete-dropdown';
    searchInput.parentElement.appendChild(autoCompleteDiv);
  }
  
  if (suggestions.length === 0) {
    hideAutoComplete();
    return;
  }
  
  autoCompleteDiv.innerHTML = suggestions.map(suggestion => `
    <div class="autocomplete-item" onclick="selectAutoComplete('${suggestion.replace(/'/g, "\\'")}')">
      🎬 ${suggestion}
    </div>
  `).join('');
  
  autoCompleteDiv.style.display = 'block';
}

function hideAutoComplete() {
  const autoCompleteDiv = document.getElementById('autocomplete');
  if (autoCompleteDiv) {
    autoCompleteDiv.style.display = 'none';
  }
}

function selectAutoComplete(suggestion) {
  searchInput.value = suggestion;
  hideAutoComplete();
  handleSearch();
}

async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    // 검색어가 없으면 모든 비디오 표시하고 태그 필터 초기화
    selectedTagFilters = [];
    renderVideos(allVideos);
    updateVideosTitle('All Videos', allVideos.length);
    currentFilter = null;
    updateTagSelection();
    return;
  }
  
  // 검색 시에는 태그 필터를 초기화
  selectedTagFilters = [];
  const results = await searchVideos(query);
  updateVideosTitle(`Search: "${query}"`, results.length);
  currentFilter = null;
  updateTagSelection();
}

async function filterByTag(tagName) {
  console.log(`🏷️  Tag clicked: "${tagName}"`);
  
  if (tagName === null || tagName === 'all') {
    // "All" 선택 - 모든 비디오 보기 + 선택된 태그 초기화
    console.log('📺 Showing all videos - clearing tag filters');
    selectedTagFilters = [];
    currentFilter = null;
    renderVideos(allVideos);
    updateVideosTitle('All Videos', allVideos.length);
  } else {
    // 특정 태그 클릭 - 토글 방식으로 추가/제거
    const tagIndex = selectedTagFilters.indexOf(tagName);
    
    if (tagIndex >= 0) {
      // 이미 선택된 태그 - 제거
      selectedTagFilters.splice(tagIndex, 1);
      console.log(`➖ Removed tag "${tagName}". Selected tags: [${selectedTagFilters.join(', ')}]`);
    } else {
      // 새로운 태그 - 추가
      selectedTagFilters.push(tagName);
      console.log(`➕ Added tag "${tagName}". Selected tags: [${selectedTagFilters.join(', ')}]`);
    }
    
    // 선택된 태그가 없으면 모든 비디오 표시
    if (selectedTagFilters.length === 0) {
      console.log('📺 No tags selected, showing all videos');
      currentFilter = null;
      renderVideos(allVideos);
      updateVideosTitle('All Videos', allVideos.length);
    } else {
      // 선택된 태그들로 필터링
      await performMultiTagSearch();
    }
  }
  
  updateTagSelection();
  searchInput.value = '';
}

async function performMultiTagSearch() {
  try {
    showLoading(true);
    console.log(`🎯 Performing multi-tag search: [${selectedTagFilters.join(', ')}]`);
    
    const results = await apiCall(`/videos/search?type=tags&tags=${encodeURIComponent(JSON.stringify(selectedTagFilters))}`);
    console.log(`📊 Found ${results.length} videos with ALL tags: [${selectedTagFilters.join(', ')}]`);
    
    renderVideos(results);
    
    // 제목 업데이트
    if (selectedTagFilters.length === 1) {
      updateVideosTitle(`Tag: ${selectedTagFilters[0]}`, results.length);
    } else {
      updateVideosTitle(`Tags: ${selectedTagFilters.join(' + ')}`, results.length);
    }
    
    currentFilter = selectedTagFilters.length > 0 ? selectedTagFilters.join(',') : null;
    
  } catch (error) {
    console.error(`❌ Error filtering by tags [${selectedTagFilters.join(', ')}]:`, error);
    showEmptyState();
    updateVideosTitle(`Tags: ${selectedTagFilters.join(' + ')}`, 0);
  } finally {
    showLoading(false);
  }
}

function updateTagSelection() {
  document.querySelectorAll('.tag').forEach(tag => {
    const tagName = tag.dataset.tagName;
    if (tagName === 'all') {
      // "All" 태그는 다른 태그가 선택되지 않았을 때만 활성화
      tag.classList.toggle('active', selectedTagFilters.length === 0);
    } else {
      // 특정 태그는 selectedTagFilters 배열에 포함되어 있으면 활성화
      tag.classList.toggle('active', selectedTagFilters.includes(tagName));
    }
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.target.closest('.upload-area').classList.add('dragover');
}

function handleDrop(e) {
  e.preventDefault();
  const uploadArea = e.target.closest('.upload-area');
  uploadArea.classList.remove('dragover');
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    showSelectedFile(files[0]);
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) {
    showSelectedFile(file);
  }
}

async function uploadFile(file) {
  try {
    const formData = new FormData();
    formData.append('video', file);
    
    // 선택된 태그들도 함께 전송
    if (uploadTags.length > 0) {
      formData.append('tags', JSON.stringify(uploadTags));
    }
    
    showUploadProgress(true, 'Saving video and generating thumbnails...');
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `Upload failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    if (result.isExisting) {
      showNotification(result.message, 'warning');
    } else {
      showNotification('✅ ' + result.message, 'success');
    }
    closeModal('uploadModal');
    
    // 업로드 태그 초기화
    uploadTags = [];
    renderUploadTags();
    
    // Reload data
    await loadVideos();
    await loadTags();
    
  } catch (error) {
    console.error('Upload error:', error);
    showNotification(`❌ Upload failed: ${error.message}`, 'error');
  } finally {
    showUploadProgress(false);
  }
}

// ==================== Upload Flow Functions ====================

let selectedFile = null; // 선택된 파일 저장
let uploadThumbnailOptions = []; // 업로드용 썸네일 옵션들
let selectedUploadThumbnail = null; // 선택된 업로드 썸네일
let currentUploadStep = 1; // 현재 업로드 단계

// ==================== Step Navigation Functions ====================

function showUploadStep(step) {
  // Hide all steps
  for (let i = 1; i <= 4; i++) {
    const stepElement = document.getElementById(`uploadStep${i}`);
    if (stepElement) {
      stepElement.style.display = 'none';
    }
  }
  
  // Show current step
  const currentStepElement = document.getElementById(`uploadStep${step}`);
  if (currentStepElement) {
    currentStepElement.style.display = 'block';
  }
  
  // Update step indicator
  updateStepIndicator(step);
  currentUploadStep = step;
}

function updateStepIndicator(activeStep) {
  for (let i = 1; i <= 4; i++) {
    const stepElement = document.getElementById(`step${i}`);
    if (stepElement) {
      stepElement.classList.remove('active', 'completed');
      
      if (i < activeStep) {
        stepElement.classList.add('completed');
      } else if (i === activeStep) {
        stepElement.classList.add('active');
      }
    }
  }
}

function resetUploadModal() {
  selectedFile = null;
  selectedUploadThumbnail = null;
  uploadThumbnailOptions = [];
  uploadTags = [];
  currentUploadStep = 1;
  
  // Reset UI
  showUploadStep(1);
  document.getElementById('selectedFileInfo').style.display = 'none';
  document.getElementById('uploadTagsContainer').innerHTML = '';
  document.getElementById('uploadThumbnailGrid').innerHTML = '';
  document.getElementById('uploadSummaryContent').innerHTML = '';
  
  // Reset file input
  document.getElementById('fileInput').value = '';
}

function proceedToTags() {
  if (!selectedFile) {
    showNotification('Please select a file first', 'error');
    return;
  }
  showUploadStep(2);
}

function backToFileSelection() {
  showUploadStep(1);
}

function proceedToThumbnailSelection() {
  showUploadStep(3);
  generateUploadThumbnails();
}

function backToTags() {
  showUploadStep(2);
}

function proceedToFinal() {
  showUploadStep(4);
  showUploadSummary();
}

function backToThumbnails() {
  showUploadStep(3);
}

function showSelectedFile(file) {
  selectedFile = file;
  
  // Update file info display
  document.getElementById('selectedFileName').textContent = file.name;
  document.getElementById('selectedFileSize').textContent = `Size: ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  document.getElementById('selectedFileInfo').style.display = 'block';
  
  console.log(`📁 File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
}

async function generateUploadThumbnails() {
  try {
    // Show loading
    document.getElementById('uploadThumbnailLoadingSpinner').style.display = 'block';
    document.getElementById('uploadThumbnailGrid').style.display = 'none';
    document.getElementById('thumbnailFallback').style.display = 'none';
    
    console.log('🎯 Generating thumbnails for upload...');
    
    // Upload file for thumbnail generation
    const formData = new FormData();
    formData.append('video', selectedFile);
    
    const response = await fetch('/api/upload-preview', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorResult = await response.json().catch(() => null);
      const errorMessage = errorResult?.message || errorResult?.error || response.statusText;
      throw new Error(`Server error (${response.status}): ${errorMessage}`);
    }
    
    const result = await response.json();
    
    console.log('📊 Full server response:', JSON.stringify(result, null, 2));
    console.log('📊 Response keys:', Object.keys(result));
    console.log('📊 Success value:', result.success);
    console.log('📊 Thumbnails:', result.thumbnails);
    console.log('📊 Message:', result.message);
    console.log('📊 Error:', result.error);
    
    if (result.success && result.thumbnails && result.thumbnails.length > 0) {
      uploadThumbnailOptions = result.thumbnails;
      renderUploadThumbnailOptions(result.thumbnails);
      document.getElementById('uploadThumbnailGrid').style.display = 'grid';
      document.getElementById('thumbnailFallback').style.display = 'none';
      console.log(`✅ Successfully loaded ${result.thumbnails.length} thumbnails`);
    } else {
      console.error('❌ Server failed to generate thumbnails');
      console.log('💡 Server message:', result.message);
      throw new Error(result.message || 'No thumbnails generated');
    }
    
  } catch (error) {
    console.error('Error generating thumbnails:', error);
    
    // Show fallback message but allow proceeding
    document.getElementById('thumbnailFallback').style.display = 'block';
    document.getElementById('uploadThumbnailGrid').style.display = 'none';
    selectedUploadThumbnail = null;
    
    console.log('💡 Network error - proceeding with default thumbnail');
    
  } finally {
    document.getElementById('uploadThumbnailLoadingSpinner').style.display = 'none';
  }
}

function renderUploadThumbnailOptions(thumbnails) {
  const grid = document.getElementById('uploadThumbnailGrid');
  
  if (!thumbnails || thumbnails.length === 0) {
    return;
  }
  
  grid.innerHTML = thumbnails.map((thumbnail, index) => `
    <div class="thumbnail-option" data-filename="${thumbnail.filename}" onclick="selectUploadThumbnail('${thumbnail.filename}', this)">
      <img src="${thumbnail.url}" alt="Thumbnail ${index + 1}" loading="lazy">
      <div class="thumbnail-info">
        <div class="thumbnail-time">${thumbnail.timemark || `Option ${index + 1}`}</div>
      </div>
    </div>
  `).join('');
}

function selectUploadThumbnail(filename, element) {
  // Remove selection from all options
  document.querySelectorAll('#uploadThumbnailGrid .thumbnail-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  // Add selection to clicked option
  element.classList.add('selected');
  selectedUploadThumbnail = filename;
  
  console.log(`🖼️  Selected upload thumbnail: ${filename}`);
}

function showUploadSummary() {
  const summaryContent = document.getElementById('uploadSummaryContent');
  
  const fileSize = selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : 'Unknown';
  const tagsText = uploadTags.length > 0 ? uploadTags.map(tag => `<span style="color: ${tag.color}">${tag.name}</span>`).join(', ') : 'No tags';
  const thumbnailText = selectedUploadThumbnail ? 'Custom thumbnail selected' : 'Default thumbnail will be used';
  
  summaryContent.innerHTML = `
    <p><strong>File:</strong> ${selectedFile ? selectedFile.name : 'Unknown'}</p>
    <p><strong>Size:</strong> ${fileSize}</p>
    <p><strong>Tags:</strong> ${tagsText}</p>
    <p><strong>Thumbnail:</strong> ${thumbnailText}</p>
  `;
}

function renderUploadThumbnailOptions(thumbnails) {
  const grid = document.getElementById('uploadThumbnailGrid');
  
  if (!thumbnails || thumbnails.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: #aaa;">
        <p>No thumbnail options available. A default thumbnail will be used.</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = thumbnails.map((thumbnail, index) => `
    <div class="thumbnail-option" data-filename="${thumbnail.filename}" onclick="selectUploadThumbnail('${thumbnail.filename}', this)">
      <img src="${thumbnail.url}" alt="Thumbnail ${index + 1}" loading="lazy">
      <div class="thumbnail-info">
        <div class="thumbnail-time">${thumbnail.timemark}</div>
      </div>
    </div>
  `).join('');
}

function selectUploadThumbnail(filename, element) {
  // 모든 옵션에서 선택 해제
  document.querySelectorAll('#uploadThumbnailGrid .thumbnail-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  // 선택된 옵션 표시
  element.classList.add('selected');
  selectedUploadThumbnail = filename;
  
  // 다음 단계 버튼 활성화
  document.getElementById('proceedToFinalBtn').disabled = false;
}

function proceedToFinal() {
  showUploadStep(4);
  showUploadSummary();
}

function updateUploadStep(currentStep) {
  for (let i = 1; i <= 4; i++) {
    const step = document.getElementById(`step${i}`);
    step.classList.remove('active', 'completed');
    
    if (i < currentStep) {
      step.classList.add('completed');
    } else if (i === currentStep) {
      step.classList.add('active');
    }
  }
}

function resetUploadArea() {
  selectedFile = null;
  selectedUploadThumbnail = null;
  uploadThumbnailOptions = [];
  uploadTags = [];
  
  const uploadArea = document.getElementById('uploadArea');
  const placeholder = uploadArea.querySelector('.upload-placeholder');
  
  placeholder.innerHTML = `
    <div class="upload-icon">📁</div>
    <p>Click or drag video file here</p>
    <p class="upload-formats">Supported: MP4, MKV, AVI, MOV</p>
  `;
  
  // 모든 섹션 숨기기
  document.querySelector('.upload-tags-section').style.display = 'none';
  document.getElementById('uploadThumbnailSection').style.display = 'none';
  document.getElementById('uploadFinalSection').style.display = 'none';
  
  // 썸네일 그리드 초기화
  document.getElementById('uploadThumbnailGrid').innerHTML = '';
  document.getElementById('uploadThumbnailGrid').style.display = 'none';
  
  // 파일 input 초기화
  document.getElementById('fileInput').value = '';
  
  // 태그 컨테이너 초기화
  renderUploadTags();
  
  // 단계 초기화
  updateUploadStep(1);
}

async function executeUpload() {
  if (!selectedFile) {
    showNotification('No file selected', 'error');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('video', selectedFile);
    
    // 선택된 태그들 추가
    if (uploadTags.length > 0) {
      formData.append('tags', JSON.stringify(uploadTags));
    }
    
    // 선택된 썸네일 추가
    if (selectedUploadThumbnail) {
      formData.append('selectedThumbnail', selectedUploadThumbnail);
    }
    
    showUploadProgress(true, 'Saving video and generating thumbnails...');
    
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `Upload failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    if (result.isExisting) {
      showNotification(result.message, 'warning');
    } else {
      showNotification('✅ ' + result.message, 'success');
    }
    
    closeModal('uploadModal');
    
    // 업로드 상태 초기화
    selectedFile = null;
    selectedUploadThumbnail = null;
    uploadThumbnailOptions = [];
    uploadTags = [];
    
    // 데이터 새로고침
    await loadVideos();
    await loadTags();
    
  } catch (error) {
    console.error('Upload error:', error);
    showNotification(`❌ Upload failed: ${error.message}`, 'error');
  } finally {
    showUploadProgress(false);
  }
}

function addUploadTag() {
  const input = document.getElementById('newUploadTagInput');
  const tagName = input.value.trim();
  
  if (!tagName) {
    showNotification('Please enter a tag name', 'error');
    return;
  }
  
  if (uploadTags.find(tag => tag.name === tagName)) {
    showNotification('Tag already added', 'warning');
    return;
  }
  
  // 기존 태그에서 찾거나 새 태그 생성
  const existingTag = allTags.find(tag => tag.name.toLowerCase() === tagName.toLowerCase());
  const newTag = existingTag || {
    name: tagName,
    color: '#007bff'
  };
  
  uploadTags.push(newTag);
  renderUploadTags();
  input.value = '';
}

function removeUploadTag(index) {
  uploadTags.splice(index, 1);
  renderUploadTags();
}

function renderUploadTags() {
  const container = document.getElementById('uploadTagsContainer');
  
  if (uploadTags.length === 0) {
    container.innerHTML = '<p style="color: #aaa; font-style: italic; margin: 0;">No tags selected</p>';
    return;
  }
  
  container.innerHTML = uploadTags.map((tag, index) => `
    <div class="upload-tag" style="background-color: ${tag.color}">
      <span>${tag.name}</span>
      <button class="remove-btn" onclick="removeUploadTag(${index})" title="Remove tag">×</button>
    </div>
  `).join('');
}

async function handleDirectoryScan() {
  const directory = document.getElementById('directoryInput').value.trim();
  if (!directory) {
    showNotification('Please enter a directory path', 'error');
    return;
  }
  
  try {
    showScanProgress(true);
    
    const result = await apiCall('/scan', {
      method: 'POST',
      body: JSON.stringify({ directory })
    });
    
    showScanResults(result);
    showNotification(`Scan completed: ${result.processed} videos processed`, 'success');
    
    // Reload data
    await loadVideos();
    await loadTags();
    
  } catch (error) {
    console.error('Scan error:', error);
    showNotification(`Scan failed: ${error.message}`, 'error');
  } finally {
    showScanProgress(false);
  }
}

async function handleCreateTag() {
  const name = document.getElementById('tagNameInput').value.trim();
  const color = document.getElementById('tagColorInput').value;
  
  if (!name) {
    showNotification('Please enter a tag name', 'error');
    return;
  }
  
  try {
    await apiCall('/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color })
    });
    
    showNotification('Tag created successfully!', 'success');
    closeModal('newTagModal');
    
    // Clear form
    document.getElementById('tagNameInput').value = '';
    document.getElementById('tagColorInput').value = '#007bff';
    
    // Reload tags
    await loadTags();
    
  } catch (error) {
    console.error('Create tag error:', error);
    showNotification(`Failed to create tag: ${error.message}`, 'error');
  }
}

// ==================== Video Modal Functions ====================

async function openVideoModal(videoId) {
  try {
    currentVideoId = videoId;
    const video = await apiCall(`/videos/${videoId}`);
    
    // Update modal content
    document.getElementById('videoTitle').textContent = video.title;
    document.getElementById('videoFilename').textContent = video.filename;
    document.getElementById('videoSize').textContent = formatFileSize(video.file_size);
    document.getElementById('videoDuration').textContent = formatDuration(video.duration);
    document.getElementById('videoResolution').textContent = `${video.width}x${video.height}`;
    
    // Setup video player
    const videoPlayer = document.getElementById('videoPlayer');
    videoPlayer.src = `/api/videos/${videoId}/stream`;
    
    // Render tags
    renderVideoTags(video);
    
    // Set video ID in modal for tag operations
    const videoModal = document.getElementById('videoModal');
    videoModal.dataset.videoId = videoId;
    
    openModal('videoModal');
    
  } catch (error) {
    console.error('Error opening video modal:', error);
    showNotification('Failed to load video details', 'error');
  }
}

function renderVideoTags(video) {
  const container = document.getElementById('videoTagsContainer');
  container.innerHTML = video.tags.map((tag, index) => `
    <span class="video-tag" style="background-color: ${video.tag_colors[index] || '#007bff'}">
      ${tag}
      <button onclick="removeTagFromVideo(${video.id}, ${video.tag_ids[index]})" style="margin-left: 8px; background: none; border: none; color: white; cursor: pointer;">×</button>
    </span>
  `).join('');
}

async function removeTagFromVideo(videoId, tagId) {
  try {
    await apiCall(`/videos/${videoId}/tags/${tagId}`, { method: 'DELETE' });
    showNotification('Tag removed successfully!', 'success');
    
    // Reload video details
    const video = await apiCall(`/videos/${videoId}`);
    renderVideoTags(video);
    
    // Reload videos and tags
    await loadVideos();
    await loadTags();
    
  } catch (error) {
    console.error('Error removing tag:', error);
    showNotification('Failed to remove tag', 'error');
  }
}

async function handleAddVideoTag() {
  const input = document.getElementById('newVideoTagInput');
  const tagName = input.value.trim();
  
  if (!tagName) {
    showNotification('Please enter a tag name', 'error');
    return;
  }

  // Get current video ID from the modal
  const videoModal = document.getElementById('videoModal');
  const videoId = videoModal.dataset.videoId;
  
  if (!videoId) {
    showNotification('Video ID not found', 'error');
    return;
  }

  try {
    await apiCall(`/videos/${videoId}/tags`, {
      method: 'POST',
      body: JSON.stringify({
        tagName: tagName,
        tagColor: '#007bff'
      })
    });

    showNotification('Tag added successfully!', 'success');
    input.value = '';

    // Reload video details
    const video = await apiCall(`/videos/${videoId}`);
    renderVideoTags(video);
    
    // Reload videos and tags
    await loadVideos();
    await loadTags();

  } catch (error) {
    console.error('Error adding tag to video:', error);
    showNotification('Failed to add tag', 'error');
  }
}

// ==================== Preview Functions ====================

function startPreview(element, videoId) {
  console.log(`🎬 Starting preview for video ${videoId}`);
  
  const video = element.querySelector('video');
  console.log(`📹 Video element found:`, !!video);
  
  if (!video) {
    console.error(`❌ No video element found in preview container`);
    return;
  }
  
  console.log(`📊 Video state:`, {
    readyState: video.readyState,
    src: video.currentSrc,
    duration: video.duration,
    paused: video.paused,
    ended: video.ended
  });
  
  if (video && video.readyState >= 2) {
    console.log(`▶️  Video ready - playing immediately`);
    video.currentTime = 0;
    video.play().catch(error => {
      console.error(`❌ Play error:`, error);
    });
  } else if (video) {
    console.log(`⏳ Video not ready - loading first`);
    video.load();
    video.addEventListener('loadeddata', () => {
      console.log(`✅ Video loaded - now playing`);
      video.play().catch(error => {
        console.error(`❌ Play error after load:`, error);
      });
    }, { once: true });
    
    video.addEventListener('error', (e) => {
      console.error(`❌ Video error:`, e, video.error);
    }, { once: true });
  }
}

function stopPreview(element) {
  console.log(`⏸️  Stopping preview`);
  
  const video = element.querySelector('video');
  if (video) {
    console.log(`⏹️  Pausing video`);
    video.pause();
    video.currentTime = 0;
  } else {
    console.log(`❌ No video element found to stop`);
  }
}

// ==================== Thumbnail Selection Functions ====================

let currentThumbnailVideoId = null;
let selectedThumbnailFilename = null;
let thumbnailOptions = [];

async function openThumbnailModal(videoId) {
  try {
    currentThumbnailVideoId = videoId;
    selectedThumbnailFilename = null;
    
    openModal('thumbnailModal');
    
    // Show loading
    document.getElementById('thumbnailLoadingSpinner').style.display = 'block';
    document.getElementById('thumbnailGrid').style.display = 'none';
    document.getElementById('thumbnailActions').style.display = 'none';
    
    console.log(`🎯 Loading thumbnail options for video ${videoId}`);
    
    const response = await apiCall(`/videos/${videoId}/thumbnail-options`);
    thumbnailOptions = response.thumbnails;
    
    renderThumbnailOptions(response.thumbnails, response.currentThumbnail);
    
    // Hide loading
    document.getElementById('thumbnailLoadingSpinner').style.display = 'none';
    document.getElementById('thumbnailGrid').style.display = 'grid';
    document.getElementById('thumbnailActions').style.display = 'flex';
    
  } catch (error) {
    console.error('Error loading thumbnail options:', error);
    showNotification('Failed to load thumbnail options', 'error');
    closeModal('thumbnailModal');
  }
}

function renderThumbnailOptions(thumbnails, currentThumbnail) {
  const grid = document.getElementById('thumbnailGrid');
  
  if (thumbnails.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #aaa;">
        <p>⚠️ No thumbnail options could be generated.</p>
        <p style="font-size: 0.9rem; margin-top: 10px;">FFmpeg may not be available on this system.</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = thumbnails.map((thumbnail, index) => {
    const isCurrent = currentThumbnail && currentThumbnail === thumbnail.filename;
    return `
      <div class="thumbnail-option ${isCurrent ? 'selected' : ''}" 
           data-filename="${thumbnail.filename}"
           onclick="selectThumbnail('${thumbnail.filename}', this)">
        <img src="${thumbnail.url}" alt="Thumbnail ${index + 1}" loading="lazy">
        ${isCurrent ? '<div class="thumbnail-current">Current</div>' : ''}
        <div class="thumbnail-info">
          <div class="thumbnail-time">${thumbnail.timemark}</div>
        </div>
      </div>
    `;
  }).join('');
  
  // If there's a current thumbnail, select it by default
  if (currentThumbnail) {
    selectedThumbnailFilename = currentThumbnail;
    updateSaveThumbnailButton();
  }
}

function selectThumbnail(filename, element) {
  // Remove selection from all options
  document.querySelectorAll('.thumbnail-option').forEach(option => {
    option.classList.remove('selected');
  });
  
  // Add selection to clicked option
  element.classList.add('selected');
  selectedThumbnailFilename = filename;
  
  updateSaveThumbnailButton();
}

function updateSaveThumbnailButton() {
  const saveBtn = document.getElementById('saveThumbnailBtn');
  const hasSelection = selectedThumbnailFilename !== null;
  
  saveBtn.disabled = !hasSelection;
  saveBtn.textContent = hasSelection ? 'Save Selection' : 'Select a thumbnail';
}

async function saveThumbnailSelection() {
  if (!currentThumbnailVideoId || !selectedThumbnailFilename) {
    showNotification('Please select a thumbnail', 'error');
    return;
  }
  
  try {
    const saveBtn = document.getElementById('saveThumbnailBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    await apiCall(`/videos/${currentThumbnailVideoId}/set-thumbnail`, {
      method: 'POST',
      body: JSON.stringify({ thumbnailFilename: selectedThumbnailFilename })
    });
    
    showNotification('Thumbnail updated successfully!', 'success');
    closeModal('thumbnailModal');
    
    // Reload videos to show updated thumbnail
    await loadVideos();
    
    // Force refresh of thumbnail image by updating timestamp
    const videoCard = document.querySelector(`[data-video-id="${currentThumbnailVideoId}"]`);
    if (videoCard) {
      const img = videoCard.querySelector('.video-thumbnail img');
      if (img && img.src.includes('/thumbnails/')) {
        img.src = img.src + '?t=' + Date.now();
      }
    }
    
  } catch (error) {
    console.error('Error saving thumbnail:', error);
    showNotification('Failed to save thumbnail', 'error');
    
    const saveBtn = document.getElementById('saveThumbnailBtn');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Selection';
  }
}

// ==================== Utility Functions ====================

function getThumbnailFilename(originalFilename) {
  const name = originalFilename.split('.').slice(0, -1).join('.');
  return `thumb_${name}.jpg`;
}

function getThumbnailUrl(filename) {
  const thumbnailFilename = getThumbnailFilename(filename);
  const svgFilename = thumbnailFilename.replace('.jpg', '.svg');
  
  // SVG 썸네일도 시도해보기 위한 URL 리스트 반환
  return {
    jpg: `/thumbnails/${thumbnailFilename}`,
    svg: `/thumbnails/${svgFilename}`
  };
}

function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 Bytes';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ==================== UI Helper Functions ====================

function openModal(modalId) {
  document.getElementById(modalId).style.display = 'block';
  document.body.style.overflow = 'hidden';
  
  // 업로드 모달이 열릴 때 초기화
  if (modalId === 'uploadModal') {
    resetUploadModal();
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
  document.body.style.overflow = 'auto';
  
  // Stop any playing video in modal
  const modal = document.getElementById(modalId);
  const videos = modal.querySelectorAll('video');
  videos.forEach(video => {
    video.pause();
    video.currentTime = 0;
  });
}

function showLoading(show) {
  loadingSpinner.style.display = show ? 'block' : 'none';
  videoGrid.style.display = show ? 'none' : 'grid';
}

function showEmptyState() {
  videoGrid.innerHTML = ''; // Clear any remaining video content
  videoGrid.style.display = 'none';
  emptyState.style.display = 'block';
}

function hideEmptyState() {
  emptyState.style.display = 'none';
  videoGrid.style.display = 'grid';
}

function updateVideosTitle(title, count) {
  videosTitle.textContent = `${title} (${count})`;
}

function showUploadProgress(show, message = 'Uploading...') {
  const progressElement = document.getElementById('uploadProgress');
  const progressText = progressElement.querySelector('.progress-text');
  
  if (progressText) {
    progressText.textContent = message;
  }
  
  progressElement.style.display = show ? 'block' : 'none';
  document.getElementById('uploadArea').style.display = show ? 'none' : 'block';
}

function showScanProgress(show) {
  document.getElementById('scanProgress').style.display = show ? 'block' : 'none';
}

function showScanResults(result) {
  const container = document.getElementById('scanResults');
  const content = document.getElementById('scanResultsContent');
  
  content.innerHTML = `
    <p><strong>Total files found:</strong> ${result.totalFound}</p>
    <p><strong>New videos processed:</strong> ${result.processed}</p>
    <p><strong>Status:</strong> ${result.message}</p>
  `;
  
  container.style.display = 'block';
}

function showNotification(message, type = 'info') {
  // Simple notification system
  const notification = document.createElement('div');
  const colors = {
    error: '#dc3545',
    success: '#28a745', 
    warning: '#ffc107',
    info: '#007bff'
  };
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 25px;
    background: ${colors[type] || colors.info};
    color: ${type === 'warning' ? '#212529' : 'white'};
    border-radius: 8px;
    z-index: 10000;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transform: translateX(100%);
    transition: transform 0.3s ease;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  // Animate in
  setTimeout(() => {
    notification.style.transform = 'translateX(0)';
  }, 10);
  
  // Remove after delay
  setTimeout(() => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

// ==================== Tag Manager Functions ====================

async function openTagManager() {
  try {
    // 태그 데이터 로드
    tagManagerData = await apiCall('/tags');
    
    openModal('tagManagerModal');
    setupTagManagerHandlers();
    renderTagStats();
    renderTagManagerList();
    
  } catch (error) {
    console.error('Error opening tag manager:', error);
    showNotification('Failed to load tag manager', 'error');
  }
}

function setupTagManagerHandlers() {
  // 카테고리 필터
  document.getElementById('tagCategoryFilter').addEventListener('change', renderTagManagerList);
  
  // 새 태그 추가
  document.getElementById('addNewTagBtn').addEventListener('click', showTagEditForm);
  
  // 태그 편집 폼 핸들러
  document.getElementById('saveTagBtn').addEventListener('click', saveTagEdit);
  document.getElementById('cancelTagEditBtn').addEventListener('click', hideTagEditForm);
}

function renderTagStats() {
  const regionTags = tagManagerData.filter(tag => tag.category === 'region');
  const genreTags = tagManagerData.filter(tag => tag.category === 'genre');
  const customTags = tagManagerData.filter(tag => tag.category === 'custom');
  
  document.getElementById('totalTagsCount').textContent = tagManagerData.length;
  document.getElementById('regionTagsCount').textContent = regionTags.length;
  document.getElementById('genreTagsCount').textContent = genreTags.length;
  document.getElementById('customTagsCount').textContent = customTags.length;
}

function renderTagManagerList() {
  const categoryFilter = document.getElementById('tagCategoryFilter').value;
  const list = document.getElementById('tagManagerList');
  
  let filteredTags = tagManagerData;
  if (categoryFilter !== 'all') {
    filteredTags = tagManagerData.filter(tag => tag.category === categoryFilter);
  }
  
  if (filteredTags.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #aaa; padding: 20px;">No tags found</p>';
    return;
  }
  
  list.innerHTML = filteredTags.map(tag => `
    <div class="tag-manager-item" data-tag-id="${tag.id}">
      <div class="tag-manager-info">
        <div class="tag-manager-preview" style="background-color: ${tag.color}; color: white;">
          ${tag.name}
        </div>
        <div class="tag-manager-details">
          <div class="tag-manager-name">${tag.name}</div>
          <div class="tag-manager-meta">
            ${tag.category} • ${tag.video_count} videos • Level ${tag.level}
          </div>
        </div>
      </div>
      <div class="tag-manager-actions">
        <button class="btn btn-small btn-secondary" onclick="editTag(${tag.id})">Edit</button>
        <button class="btn btn-small btn-secondary" onclick="deleteTag(${tag.id})" style="background: #dc3545; border-color: #dc3545;">Delete</button>
      </div>
    </div>
  `).join('');
}

function showTagEditForm(tagId = null) {
  editingTagId = tagId;
  const form = document.getElementById('tagEditForm');
  const title = document.getElementById('tagEditFormTitle');
  
  if (tagId) {
    // 편집 모드
    const tag = tagManagerData.find(t => t.id === tagId);
    if (!tag) return;
    
    title.textContent = 'Edit Tag';
    document.getElementById('editTagName').value = tag.name;
    document.getElementById('editTagColor').value = tag.color;
    document.getElementById('editTagCategory').value = tag.category;
  } else {
    // 새 태그 모드
    title.textContent = 'Add New Tag';
    document.getElementById('editTagName').value = '';
    document.getElementById('editTagColor').value = '#007bff';
    document.getElementById('editTagCategory').value = 'custom';
  }
  
  form.style.display = 'block';
  document.getElementById('editTagName').focus();
}

function hideTagEditForm() {
  document.getElementById('tagEditForm').style.display = 'none';
  editingTagId = null;
}

async function saveTagEdit() {
  const name = document.getElementById('editTagName').value.trim();
  const color = document.getElementById('editTagColor').value;
  const category = document.getElementById('editTagCategory').value;
  
  if (!name) {
    showNotification('Please enter a tag name', 'error');
    return;
  }
  
  try {
    if (editingTagId) {
      // 편집 모드
      await apiCall(`/tags/${editingTagId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, color, category })
      });
      showNotification('Tag updated successfully!', 'success');
    } else {
      // 새 태그 모드
      await apiCall('/tags', {
        method: 'POST',
        body: JSON.stringify({ name, color, category })
      });
      showNotification('Tag created successfully!', 'success');
    }
    
    // 데이터 새로고침
    tagManagerData = await apiCall('/tags');
    renderTagStats();
    renderTagManagerList();
    hideTagEditForm();
    
    // 메인 태그 목록도 새로고침
    await loadTags();
    
  } catch (error) {
    console.error('Error saving tag:', error);
    showNotification('Failed to save tag', 'error');
  }
}

async function editTag(tagId) {
  showTagEditForm(tagId);
}

async function deleteTag(tagId) {
  const tag = tagManagerData.find(t => t.id === tagId);
  if (!tag) return;
  
  if (tag.video_count > 0) {
    if (!confirm(`Tag "${tag.name}" is used by ${tag.video_count} videos. Are you sure you want to delete it?`)) {
      return;
    }
  } else {
    if (!confirm(`Are you sure you want to delete tag "${tag.name}"?`)) {
      return;
    }
  }
  
  try {
    await apiCall(`/tags/${tagId}`, { method: 'DELETE' });
    showNotification('Tag deleted successfully!', 'success');
    
    // 데이터 새로고침
    tagManagerData = await apiCall('/tags');
    renderTagStats();
    renderTagManagerList();
    
    // 메인 태그 목록도 새로고침
    await loadTags();
    
  } catch (error) {
    console.error('Error deleting tag:', error);
    showNotification('Failed to delete tag', 'error');
  }
}

// ==================== Filter System Functions ====================

function setupFilterHandlers() {
  // 사이드바 토글
  document.getElementById('toggleSidebarBtn').addEventListener('click', toggleSidebar);
  
  // 모든 필터 초기화
  document.getElementById('clearAllFiltersBtn').addEventListener('click', clearAllFilters);
  
  // 해상도 필터
  document.querySelectorAll('input[data-filter="resolution"]').forEach(checkbox => {
    checkbox.addEventListener('change', handleResolutionFilter);
  });
  
  // 비디오 길이 프리셋 버튼
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', handleDurationPreset);
  });
  
  // 범위 슬라이더
  document.getElementById('durationMin').addEventListener('input', handleDurationSlider);
  document.getElementById('durationMax').addEventListener('input', handleDurationSlider);
  
  // 날짜 필터
  document.getElementById('dateFilter').addEventListener('change', handleDateFilter);
  document.getElementById('dateFrom').addEventListener('change', handleCustomDateFilter);
  document.getElementById('dateTo').addEventListener('change', handleCustomDateFilter);
  
  // 초기 슬라이더 값 설정
  updateDurationSliderValues();
  updateRangeSliderBackground();
}

function toggleSidebar() {
  const sidebar = document.getElementById('filterSidebar');
  const toggleIcon = document.getElementById('sidebarToggleIcon');
  
  isSidebarCollapsed = !isSidebarCollapsed;
  
  if (isSidebarCollapsed) {
    sidebar.classList.add('collapsed');
    toggleIcon.textContent = '▶';
  } else {
    sidebar.classList.remove('collapsed');
    toggleIcon.textContent = '◀';
  }
}

function clearAllFilters() {
  // 필터 상태 초기화
  filterState = {
    tags: [],
    resolution: [],
    durationMin: 0,
    durationMax: 14400,
    dateFilter: '',
    dateFrom: '',
    dateTo: ''
  };
  
  // 태그 필터 초기화
  selectedTagFilters = [];
  
  // UI 초기화
  document.querySelectorAll('input[data-filter="resolution"]').forEach(cb => cb.checked = false);
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('durationMin').value = 0;
  document.getElementById('durationMax').value = 14400;
  document.getElementById('dateFilter').value = '';
  document.getElementById('customDateRange').style.display = 'none';
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  
  updateDurationSliderValues();
  updateRangeSliderBackground();
  updateTagSelection();
  
  // 모든 비디오 표시
  renderVideos(allVideos);
  updateVideosTitle('All Videos', allVideos.length);
  
  showNotification('All filters cleared', 'success');
}

function handleResolutionFilter(event) {
  const value = event.target.value;
  const isChecked = event.target.checked;
  
  if (isChecked) {
    if (!filterState.resolution.includes(value)) {
      filterState.resolution.push(value);
    }
  } else {
    filterState.resolution = filterState.resolution.filter(r => r !== value);
  }
  
  console.log('Resolution filters:', filterState.resolution);
  applyFilters();
}

function handleDurationPreset(event) {
  const btn = event.target;
  const min = parseInt(btn.dataset.min);
  const max = parseInt(btn.dataset.max);
  
  // 모든 프리셋 버튼에서 active 제거
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  
  // 클릭된 버튼에 active 추가
  btn.classList.add('active');
  
  // 슬라이더 값 업데이트
  document.getElementById('durationMin').value = min;
  document.getElementById('durationMax').value = Math.min(max, 14400);
  
  // 필터 상태 업데이트
  filterState.durationMin = min;
  filterState.durationMax = Math.min(max, 14400);
  
  updateDurationSliderValues();
  updateRangeSliderBackground();
  applyFilters();
}

function handleDurationSlider(event) {
  const minSlider = document.getElementById('durationMin');
  const maxSlider = document.getElementById('durationMax');
  
  let min = parseInt(minSlider.value);
  let max = parseInt(maxSlider.value);
  
  // 최소값이 최대값보다 크거나 같으면 조정 (최소 5분 간격 유지)
  if (min >= max) {
    if (event.target === minSlider) {
      max = Math.min(min + 300, 14400); // 최소 5분 차이, 최대값 제한
      maxSlider.value = max;
    } else {
      min = Math.max(max - 300, 0); // 최소 5분 차이, 최소값 제한
      minSlider.value = min;
    }
  }
  
  filterState.durationMin = min;
  filterState.durationMax = max;
  
  // 프리셋 버튼 비활성화
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
  
  updateDurationSliderValues();
  updateRangeSliderBackground(); // 범위 시각화 업데이트
  applyFilters();
}

function updateDurationSliderValues() {
  const minValue = document.getElementById('durationMinValue');
  const maxValue = document.getElementById('durationMaxValue');
  
  minValue.textContent = formatMinutes(filterState.durationMin);
  maxValue.textContent = formatMinutes(filterState.durationMax);
}

function updateRangeSliderBackground() {
  const minSlider = document.getElementById('durationMin');
  const maxSlider = document.getElementById('durationMax');
  const rangeContainer = document.querySelector('.range-slider');
  
  const min = parseInt(minSlider.value);
  const max = parseInt(maxSlider.value);
  const minPercent = (min / 14400) * 100;
  const maxPercent = (max / 14400) * 100;
  
  // 범위 배경색 업데이트
  rangeContainer.style.background = `linear-gradient(to right, 
    var(--border-light) 0%, 
    var(--border-light) ${minPercent}%, 
    var(--accent-primary) ${minPercent}%, 
    var(--accent-primary) ${maxPercent}%, 
    var(--border-light) ${maxPercent}%, 
    var(--border-light) 100%)`;
}

function formatMinutes(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}시간 ${remainingMinutes}분`;
  }
  return `${minutes}분`;
}

function handleDateFilter(event) {
  const value = event.target.value;
  filterState.dateFilter = value;
  
  const customDateRange = document.getElementById('customDateRange');
  
  if (value === 'custom') {
    customDateRange.style.display = 'block';
  } else {
    customDateRange.style.display = 'none';
    filterState.dateFrom = '';
    filterState.dateTo = '';
    applyFilters();
  }
}

function handleCustomDateFilter() {
  filterState.dateFrom = document.getElementById('dateFrom').value;
  filterState.dateTo = document.getElementById('dateTo').value;
  
  if (filterState.dateFrom && filterState.dateTo) {
    applyFilters();
  }
}

async function applyFilters() {
  try {
    showLoading(true);
    
    // 필터 조건을 API 쿼리로 변환
    const params = new URLSearchParams();
    
    // 태그 필터
    if (selectedTagFilters.length > 0) {
      params.append('tags', JSON.stringify(selectedTagFilters));
    }
    
    // 해상도 필터
    if (filterState.resolution.length > 0) {
      params.append('resolution', JSON.stringify(filterState.resolution));
    }
    
    // 비디오 길이 필터
    if (filterState.durationMin > 0 || filterState.durationMax < 14400) {
      params.append('durationMin', filterState.durationMin);
      params.append('durationMax', filterState.durationMax);
    }
    
    // 날짜 필터
    if (filterState.dateFilter) {
      params.append('dateFilter', filterState.dateFilter);
      if (filterState.dateFilter === 'custom' && filterState.dateFrom && filterState.dateTo) {
        params.append('dateFrom', filterState.dateFrom);
        params.append('dateTo', filterState.dateTo);
      }
    }
    
    console.log('Applying filters:', Object.fromEntries(params));
    
    const results = await apiCall(`/videos/filter?${params.toString()}`);
    renderVideos(results);
    
    // 제목 업데이트
    const activeFilters = [];
    if (selectedTagFilters.length > 0) activeFilters.push(`Tags: ${selectedTagFilters.join(', ')}`);
    if (filterState.resolution.length > 0) activeFilters.push(`Resolution: ${filterState.resolution.join(', ')}`);
    if (filterState.durationMin > 0 || filterState.durationMax < 14400) {
      activeFilters.push(`Duration: ${formatMinutes(filterState.durationMin)}-${formatMinutes(filterState.durationMax)}`);
    }
    if (filterState.dateFilter) activeFilters.push(`Date: ${filterState.dateFilter}`);
    
    const title = activeFilters.length > 0 ? `Filtered Results` : 'All Videos';
    updateVideosTitle(title, results.length);
    
  } catch (error) {
    console.error('Error applying filters:', error);
    showNotification('Failed to apply filters', 'error');
  } finally {
    showLoading(false);
  }
}

// 해상도 분류 함수
function getResolutionCategory(width, height) {
  const pixels = width * height;
  
  if (height <= 480) return 'sd';
  if (height <= 720) return 'hd';
  if (height <= 1080) return 'fullhd';
  if (height <= 1440) return '2k';
  if (height <= 2160) return '4k';
  return 'other';
}

console.log('📱 Video Server UI loaded successfully!');