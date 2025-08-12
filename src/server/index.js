const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs-extra');

// 모델 및 유틸리티 임포트
const Video = require('./models/Video');
const Tag = require('./models/Tag');
const FileScanner = require('./utils/fileScanner');
const ThumbnailGenerator = require('./utils/thumbnailGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 서빙
app.use('/thumbnails', express.static(path.join(__dirname, '../../thumbnails')));
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));
app.use(express.static(path.join(__dirname, '../client')));

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads');
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 원본 파일명 디코딩
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uploadDir = path.join(__dirname, '../../uploads');
    let finalName = originalName;
    let counter = 1;
    
    // 파일명 중복 체크 및 번호 추가
    while (fs.existsSync(path.join(uploadDir, finalName))) {
      const parsed = path.parse(originalName);
      finalName = `${parsed.name}_${counter}${parsed.ext}`;
      counter++;
    }
    
    cb(null, finalName);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 비디오 형식입니다.'), false);
    }
  }
});

// 전역 인스턴스
const fileScanner = new FileScanner();
const thumbnailGenerator = new ThumbnailGenerator(path.join(__dirname, '../../thumbnails'));

// 모든 selection 썸네일 정리 함수 (thumb 파일 생성 후 selection 파일들 모두 삭제)
async function cleanupUnusedThumbnails(filename, selectedThumbnail) {
  try {
    const thumbnailDir = path.join(__dirname, '../../thumbnails');
    const baseName = path.parse(filename).name;
    
    console.log(`🧹 Cleaning up unused thumbnails for: ${filename}`);
    console.log(`🎯 Selected thumbnail: ${selectedThumbnail}`);
    console.log(`📝 Base name extracted: ${baseName}`);
    
    // 썸네일 디렉토리의 모든 파일 읽기
    const files = await fs.readdir(thumbnailDir);
    
    // selection_*_thumb_*.jpg 패턴의 모든 파일들 찾기 (더 넓은 매칭)
    const selectionThumbnails = files.filter(file => 
      file.startsWith('selection_') && 
      file.includes('thumb_') && 
      file.endsWith('.jpg')
    );
    
    console.log(`📄 All selection thumbnails found: ${selectionThumbnails.join(', ')}`);
    
    // 특정 비디오와 매칭되는 썸네일들만 필터링
    const matchingThumbnails = selectionThumbnails.filter(file => {
      // 더 유연한 매칭: 베이스 네임이 포함되거나 유사한 패턴
      const fileBaseName = file.replace('selection_', '').replace(/^\d+_thumb_/, '').replace('.jpg', '');
      const targetBaseName = baseName.replace(/_\d+$/, ''); // 끝의 숫자 제거 (예: _1, _2)
      
      return fileBaseName.includes(targetBaseName) || targetBaseName.includes(fileBaseName) || 
             file.includes(`thumb_${baseName}`) || file.includes(`thumb_${targetBaseName}`);
    });
    
    console.log(`🎯 Matching selection thumbnails: ${matchingThumbnails.join(', ')}`);
    
    let deletedCount = 0;
    
    // 모든 selection 썸네일들 삭제 (선택된 것 포함)
    // thumb_ 파일로 복사된 후에는 selection_ 파일들이 불필요하므로 모두 삭제
    for (const thumbnail of matchingThumbnails) {
      const thumbnailPath = path.join(thumbnailDir, thumbnail);
      try {
        await fs.remove(thumbnailPath);
        console.log(`🗑️  Deleted selection thumbnail: ${thumbnail}`);
        deletedCount++;
      } catch (deleteError) {
        console.warn(`⚠️  Could not delete thumbnail ${thumbnail}:`, deleteError.message);
      }
    }
    
    console.log(`✅ Cleanup completed: deleted ${deletedCount} selection thumbnails (thumb_ file created, selection files no longer needed)`);
    
  } catch (error) {
    console.warn('⚠️  Error during thumbnail cleanup:', error.message);
  }
}

// 모든 selection_* 썸네일 삭제 함수 (썸네일 선택 전 정리용)
async function cleanupAllSelectionThumbnails(filename) {
  try {
    const thumbnailDir = path.join(__dirname, '../../thumbnails');
    const baseName = path.parse(filename).name;
    
    console.log(`🧹 Cleaning up ALL selection thumbnails for: ${filename}`);
    
    // 썸네일 디렉토리의 모든 파일 읽기
    const files = await fs.readdir(thumbnailDir);
    
    // selection_*_thumb_{baseName}.jpg 패턴의 파일들 찾기
    const selectionThumbnails = files.filter(file => 
      file.startsWith('selection_') && 
      file.includes(`thumb_${baseName}`) && 
      file.endsWith('.jpg')
    );
    
    console.log(`📄 Found selection thumbnails to delete: ${selectionThumbnails.join(', ')}`);
    
    let deletedCount = 0;
    
    // 모든 selection_ 썸네일들 삭제
    for (const thumbnail of selectionThumbnails) {
      const thumbnailPath = path.join(thumbnailDir, thumbnail);
      try {
        await fs.remove(thumbnailPath);
        console.log(`🗑️  Deleted selection thumbnail: ${thumbnail}`);
        deletedCount++;
      } catch (deleteError) {
        console.warn(`⚠️  Could not delete thumbnail ${thumbnail}:`, deleteError.message);
      }
    }
    
    console.log(`✅ All selection thumbnails cleanup completed: deleted ${deletedCount} files`);
    
  } catch (error) {
    console.warn('⚠️  Error during selection thumbnails cleanup:', error.message);
  }
}

// ==================== API 라우트 ====================

// 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// 모든 비디오 조회
app.get('/api/videos', async (req, res) => {
  try {
    const video = new Video();
    const videos = await video.getAllVideos();
    await video.close();
    res.json(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// 비디오 검색
app.get('/api/videos/search', async (req, res) => {
  try {
    const { q, type = 'title', tags } = req.query;
    
    const video = new Video();
    let results;
    
    if (type === 'tags' && tags) {
      // 다중 태그 검색 (tags 파라미터는 JSON 배열 문자열)
      const tagNames = JSON.parse(tags);
      console.log(`🎯 Multi-tag search requested: [${tagNames.join(', ')}]`);
      results = await video.searchByTags(tagNames);
    } else if (type === 'tag' && q) {
      // 단일 태그 검색
      console.log(`🏷️  Single tag search requested: "${q}"`);
      results = await video.searchByTag(q);
    } else if (q) {
      // 제목 검색 - 향상된 검색 사용
      console.log(`🔍 Enhanced title search requested: "${q}"`);
      results = await video.enhancedSearchByTitle(q);
    } else {
      return res.status(400).json({ error: 'Search query or tags are required' });
    }
    
    await video.close();
    res.json(results);
  } catch (error) {
    console.error('Error searching videos:', error);
    res.status(500).json({ error: 'Failed to search videos' });
  }
});

// 검색 자동완성
app.get('/api/search/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }
    
    console.log(`🔍 Autocomplete requested for: "${q}"`);
    
    const video = new Video();
    const suggestions = await video.getAutoCompleteSuggestions(q, 10);
    await video.close();
    
    console.log(`💡 Found ${suggestions.length} suggestions`);
    res.json({ suggestions });
    
  } catch (error) {
    console.error('Error in autocomplete:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// 필터링된 비디오 조회 (반드시 :id 라우트보다 위에 있어야 함)
app.get('/api/videos/filter', async (req, res) => {
  try {
    const {
      tags,
      resolution,
      durationMin,
      durationMax,
      dateFilter,
      dateFrom,
      dateTo,
      sortBy = 'created_at',
      order = 'desc',
      page = 1,
      limit = 100
    } = req.query;

    console.log('🔍 Advanced filter request:', req.query);

    const video = new Video();
    const results = await video.getFilteredVideos({
      tags: tags ? JSON.parse(tags) : [],
      resolution: resolution ? JSON.parse(resolution) : [],
      durationMin: durationMin ? parseInt(durationMin) : null,
      durationMax: durationMax ? parseInt(durationMax) : null,
      dateFilter,
      dateFrom,
      dateTo,
      sortBy,
      order,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    await video.close();
    res.json(results);
  } catch (error) {
    console.error('Error filtering videos:', error);
    res.status(500).json({ error: 'Failed to filter videos' });
  }
});

// 특정 비디오 조회
app.get('/api/videos/:id', async (req, res) => {
  try {
    const video = new Video();
    const result = await video.getVideoById(req.params.id);
    await video.close();
    
    if (!result) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// 비디오 스트리밍
app.get('/api/videos/:id/stream', async (req, res) => {
  try {
    const video = new Video();
    const videoData = await video.getVideoById(req.params.id);
    await video.close();
    
    if (!videoData) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoPath = videoData.file_path;
    const stat = await fs.stat(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // 부분 요청 처리 (범위 요청)
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // 전체 파일 스트리밍
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (error) {
    console.error('Error streaming video:', error);
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

// 미리보기 비디오 스트리밍
app.get('/api/videos/:id/preview', async (req, res) => {
  try {
    const video = new Video();
    const videoData = await video.getVideoById(req.params.id);
    await video.close();
    
    if (!videoData || !videoData.preview_path) {
      return res.status(404).json({ error: 'Preview not found' });
    }

    const previewPath = videoData.preview_path;
    const stat = await fs.stat(previewPath);
    const fileSize = stat.size;

    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(previewPath).pipe(res);
  } catch (error) {
    console.error('Error streaming preview:', error);
    res.status(500).json({ error: 'Failed to stream preview' });
  }
});

// 비디오에 태그 추가
app.post('/api/videos/:id/tags', async (req, res) => {
  try {
    const { tagName, tagColor = '#007bff' } = req.body;
    
    if (!tagName) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const video = new Video();
    const tag = new Tag();
    
    // 태그 생성 또는 조회
    const tagId = await tag.findOrCreateTag(tagName, tagColor);
    
    // 비디오에 태그 추가
    await video.addTagToVideo(req.params.id, tagId);
    
    await video.close();
    await tag.close();
    
    res.json({ success: true, tagId });
  } catch (error) {
    console.error('Error adding tag to video:', error);
    res.status(500).json({ error: 'Failed to add tag' });
  }
});

// 비디오에서 태그 제거
app.delete('/api/videos/:videoId/tags/:tagId', async (req, res) => {
  try {
    const video = new Video();
    const success = await video.removeTagFromVideo(req.params.videoId, req.params.tagId);
    await video.close();
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Tag relationship not found' });
    }
  } catch (error) {
    console.error('Error removing tag from video:', error);
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

// 썸네일 선택용 이미지들 생성 API
app.get('/api/videos/:id/thumbnail-options', async (req, res) => {
  try {
    const video = new Video();
    const videoData = await video.getVideoById(req.params.id);
    await video.close();
    
    if (!videoData) {
      return res.status(404).json({ error: 'Video not found' });
    }

    console.log(`🎯 Generating thumbnail options for: ${videoData.filename}`);
    
    const thumbnails = await thumbnailGenerator.generateSelectionThumbnails(
      videoData.file_path, 
      videoData.filename, 
      6
    );
    
    res.json({ 
      success: true, 
      thumbnails,
      currentThumbnail: videoData.thumbnail_path ? path.basename(videoData.thumbnail_path) : null
    });
    
  } catch (error) {
    console.error('Error generating thumbnail options:', error);
    res.status(500).json({ error: 'Failed to generate thumbnail options' });
  }
});

// 선택된 썸네일을 메인 썸네일로 설정
app.post('/api/videos/:id/set-thumbnail', async (req, res) => {
  try {
    const { thumbnailFilename } = req.body;
    
    if (!thumbnailFilename) {
      return res.status(400).json({ error: 'Thumbnail filename is required' });
    }

    const video = new Video();
    
    // 비디오 정보 가져오기 (파일명 필요)
    const videoData = await video.getVideoById(req.params.id);
    if (!videoData) {
      await video.close();
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const thumbnailPath = path.join(thumbnailGenerator.thumbnailDir, thumbnailFilename);
    
    // 썸네일 파일이 실제로 존재하는지 확인
    if (!(await fs.pathExists(thumbnailPath))) {
      await video.close();
      return res.status(404).json({ error: 'Thumbnail file not found' });
    }
    
    // 데이터베이스 업데이트
    await video.updateVideo(req.params.id, {
      thumbnail_path: thumbnailPath,
      updated_at: new Date().toISOString()
    });
    
    await video.close();
    
    // 모든 selection 썸네일들 정리 (thumb 파일 생성 완료 후)
    console.log(`🧹 Starting cleanup for video: ${videoData.filename}`);
    await cleanupUnusedThumbnails(videoData.filename, thumbnailFilename);
    
    console.log(`✅ Thumbnail updated for video ${req.params.id}: ${thumbnailFilename}`);
    res.json({ success: true, thumbnailFilename });
    
  } catch (error) {
    console.error('Error setting thumbnail:', error);
    res.status(500).json({ error: 'Failed to set thumbnail' });
  }
});

// 모든 태그 조회
app.get('/api/tags', async (req, res) => {
  try {
    const tag = new Tag();
    const tags = await tag.getAllTags();
    await tag.close();
    res.json(tags);
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// 새 태그 생성 (계층적 구조 지원)
app.post('/api/tags', async (req, res) => {
  try {
    const { name, color = '#007bff', category = 'custom', parentId = null } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    // 레벨 결정 (부모가 있으면 레벨 2, 없으면 레벨 1)
    const level = parentId ? 2 : 1;

    const tag = new Tag();
    const tagId = await tag.createTag(name, color, parentId, category, level);
    await tag.close();
    
    res.json({ id: tagId, name, color, category, parentId, level });
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

// 태그 업데이트
app.put('/api/tags/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, category } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const tag = new Tag();
    const updated = await tag.updateTag(id, name, color, category);
    await tag.close();
    
    if (!updated) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    res.json({ success: true, message: 'Tag updated successfully' });
  } catch (error) {
    console.error('Error updating tag:', error);
    res.status(500).json({ error: 'Failed to update tag' });
  }
});

// 태그 삭제
app.delete('/api/tags/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const tag = new Tag();
    const deleted = await tag.deleteTag(id);
    await tag.close();
    
    if (!deleted) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json({ success: true, message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

// 계층적 태그 구조 조회
app.get('/api/tags/hierarchy', async (req, res) => {
  try {
    const tag = new Tag();
    const hierarchy = await tag.getHierarchicalTags();
    await tag.close();
    res.json(hierarchy);
  } catch (error) {
    console.error('Error fetching tag hierarchy:', error);
    res.status(500).json({ error: 'Failed to fetch tag hierarchy' });
  }
});

// 카테고리별 태그 조회
app.get('/api/tags/category/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const tag = new Tag();
    const tags = await tag.getTagsByCategory(category);
    await tag.close();
    res.json(tags);
  } catch (error) {
    console.error('Error fetching tags by category:', error);
    res.status(500).json({ error: 'Failed to fetch tags by category' });
  }
});

// 업로드 미리보기 - 썸네일 생성용
app.post('/api/upload-preview', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const filename = req.file.filename;
    
    console.log(`🎯 Starting thumbnail generation for upload preview:`);
    console.log(`   📁 File: ${filename}`);
    console.log(`   📍 Path: ${filePath}`);
    console.log(`   💾 Size: ${req.file.size} bytes`);
    console.log(`   🎭 MIME: ${req.file.mimetype}`);
    
    // 파일 존재 여부 확인
    const fileExists = await fs.pathExists(filePath);
    console.log(`   🔍 File exists: ${fileExists}`);
    
    if (!fileExists) {
      throw new Error(`Uploaded file not found at: ${filePath}`);
    }
    
    // 썸네일 옵션 생성
    console.log(`🚀 Calling generateSelectionThumbnails...`);
    const thumbnails = await thumbnailGenerator.generateSelectionThumbnails(
      filePath, 
      filename, 
      6
    );
    
    console.log(`📊 Thumbnail generation complete:`);
    console.log(`   ✅ Generated: ${thumbnails.length} thumbnails`);
    console.log(`   📄 Details:`, thumbnails.map(t => ({ filename: t.filename, url: t.url })));
    
    // 임시 파일이므로 나중에 정리될 것임을 표시
    req.file._isTemporary = true;
    
    if (thumbnails.length > 0) {
      res.json({ 
        success: true,
        thumbnails: thumbnails,
        tempFilePath: filePath,
        filename: filename,
        message: `Generated ${thumbnails.length} thumbnails successfully`
      });
    } else {
      throw new Error('No thumbnails were generated - this should not happen if FFmpeg is working');
    }
    
  } catch (error) {
    console.error('❌ Error in upload preview:', error.message);
    console.error('❌ Stack trace:', error.stack);
    
    // 임시 파일 정리
    if (req.file && req.file.path) {
      try {
        await fs.remove(req.file.path);
      } catch (cleanupError) {
        console.warn('Could not remove temporary file:', cleanupError.message);
      }
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate thumbnails: ' + error.message,
      message: error.message,
      thumbnails: []
    });
  }
});

// 파일 업로드 및 처리
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const filename = req.file.filename;
    
    console.log(`📤 Processing uploaded file: ${filename}`);
    
    // 업로드된 태그 정보 파싱
    let uploadTags = [];
    if (req.body.tags) {
      try {
        uploadTags = JSON.parse(req.body.tags);
        console.log(`🏷️  Tags for upload: ${uploadTags.map(t => t.name).join(', ')}`);
      } catch (parseError) {
        console.warn('⚠️  Could not parse tags:', parseError.message);
      }
    }
    
    // 파일 정보 추출
    const metadata = await fileScanner.getVideoMetadata(filePath);
    const title = fileScanner.extractTitle(filename);
    
    // 선택된 썸네일이 있는지 확인
    const selectedThumbnail = req.body.selectedThumbnail;
    let thumbnailPath;
    
    if (selectedThumbnail) {
      // 선택된 썸네일을 메인 썸네일로 복사
      const selectedThumbnailPath = path.join(thumbnailGenerator.thumbnailDir, selectedThumbnail);
      const mainThumbnailFilename = thumbnailGenerator.getThumbnailFilename(filename);
      thumbnailPath = path.join(thumbnailGenerator.thumbnailDir, mainThumbnailFilename);
      
      if (await fs.pathExists(selectedThumbnailPath)) {
        await fs.copy(selectedThumbnailPath, thumbnailPath);
        console.log(`✅ Selected thumbnail copied: ${selectedThumbnail} -> ${mainThumbnailFilename}`);
      } else {
        console.warn('⚠️  Selected thumbnail not found, generating default');
        thumbnailPath = await thumbnailGenerator.generateThumbnail(filePath, filename);
      }
    } else {
      // 기본 썸네일 생성
      thumbnailPath = await thumbnailGenerator.generateThumbnail(filePath, filename);
    }
    
    // 미리보기 생성 (선택사항 - 시간이 오래 걸릴 수 있음)
    let previewPath = null;
    try {
      console.log(`🎬 Starting preview generation for: ${filename}`);
      previewPath = await thumbnailGenerator.generatePreview(filePath, filename);
      if (previewPath) {
        console.log(`✅ Preview generated successfully: ${previewPath}`);
        const fs = require('fs-extra');
        const exists = await fs.pathExists(previewPath);
        console.log(`🔍 Preview file exists: ${exists}`);
        if (exists) {
          const stats = await fs.stat(previewPath);
          console.log(`📊 Preview file size: ${stats.size} bytes`);
        }
      } else {
        console.warn(`⚠️  Preview generation returned null/undefined`);
      }
    } catch (previewError) {
      console.error('❌ Preview generation failed:', previewError.message);
      console.error('❌ Preview error stack:', previewError.stack);
    }
    
    // 데이터베이스에 저장 (중복 체크)
    const video = new Video();
    const tag = new Tag();
    
    // 기존 파일 확인
    const existingVideo = await new Promise((resolve, reject) => {
      video.db.get('SELECT * FROM videos WHERE file_path = ?', [filePath], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    let videoId;
    if (existingVideo) {
      console.log(`📄 File already exists in database: ${filename}`);
      videoId = existingVideo.id;
      
      // 기존 파일 정보 업데이트 (필요한 경우)
      await video.updateVideo(videoId, {
        thumbnail_path: thumbnailPath,
        preview_path: previewPath,
        updated_at: new Date().toISOString()
      });
    } else {
      // 새 파일 추가
      videoId = await video.addVideo({
        filename,
        title,
        file_path: filePath,
        file_size: req.file.size,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        thumbnail_path: thumbnailPath,
        preview_path: previewPath
      });
      console.log(`✅ New video added to database: ${filename}`);
    }
    
    // 태그 처리 및 연결
    if (uploadTags.length > 0) {
      for (const tagData of uploadTags) {
        try {
          const tagId = await tag.findOrCreateTag(tagData.name, tagData.color || '#007bff');
          await video.addTagToVideo(videoId, tagId);
          console.log(`✅ Tag "${tagData.name}" linked to video`);
        } catch (tagError) {
          console.warn(`⚠️  Could not link tag "${tagData.name}":`, tagError.message);
        }
      }
    }
    
    await video.close();
    await tag.close();
    
    // 모든 selection 썸네일들 정리 (thumb 파일 생성 완료 후)
    if (selectedThumbnail) {
      await cleanupUnusedThumbnails(filename, selectedThumbnail);
    }
    
    res.json({ 
      success: true, 
      videoId,
      tagsAdded: uploadTags.length,
      isExisting: !!existingVideo,
      message: existingVideo ? 
        `File already exists, updated with ${uploadTags.length} tags` : 
        `File uploaded successfully${uploadTags.length > 0 ? ` with ${uploadTags.length} tags` : ''}`
    });
    
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: 'Failed to process upload: ' + error.message });
  }
});

// 디렉토리 스캔
app.post('/api/scan', async (req, res) => {
  try {
    const { directory } = req.body;
    
    if (!directory) {
      return res.status(400).json({ error: 'Directory path is required' });
    }

    console.log(`🔍 Scanning directory: ${directory}`);
    
    const files = await fileScanner.scanDirectory(directory);
    let processedCount = 0;
    
    for (const fileInfo of files) {
      const video = new Video();
      
      try {
        // 이미 데이터베이스에 있는지 확인
        const existing = await new Promise((resolve, reject) => {
          video.db.get('SELECT id FROM videos WHERE file_path = ?', [fileInfo.file_path], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        if (existing) {
          console.log(`⏭️  Skipping existing file: ${fileInfo.filename}`);
          await video.close();
          continue;
        }
        
        // 썸네일 생성
        const thumbnailPath = await thumbnailGenerator.generateThumbnail(
          fileInfo.file_path, 
          fileInfo.filename
        );
        
        // 미리보기 생성 시도
        let previewPath = null;
        try {
          previewPath = await thumbnailGenerator.generatePreview(
            fileInfo.file_path,
            fileInfo.filename
          );
        } catch (previewError) {
          console.warn(`⚠️  Could not generate preview for ${fileInfo.filename}:`, previewError.message);
        }
        
        // 데이터베이스에 추가
        const videoId = await video.addVideo({
          ...fileInfo,
          thumbnail_path: thumbnailPath,
          preview_path: previewPath
        });
        
        await video.close();
        processedCount++;
        
        console.log(`✅ Processed: ${fileInfo.filename} (ID: ${videoId})`);
        
      } catch (error) {
        console.error(`❌ Error processing ${fileInfo.filename}:`, error.message);
        await video.close();
      }
    }
    
    res.json({ 
      success: true, 
      totalFound: files.length,
      processed: processedCount,
      message: `Scanned ${files.length} files, processed ${processedCount} new videos`
    });
    
  } catch (error) {
    console.error('Error scanning directory:', error);
    res.status(500).json({ error: 'Failed to scan directory' });
  }
});

// 개발용 데이터베이스 초기화 API (주의: 모든 데이터 삭제)
app.delete('/api/dev/clear-database', async (req, res) => {
  try {
    const video = new Video();
    const tag = new Tag();
    
    // 모든 비디오 삭제 (CASCADE로 video_tags도 자동 삭제)
    await new Promise((resolve, reject) => {
      video.db.run('DELETE FROM videos', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // 사용되지 않는 태그 정리
    await tag.cleanupUnusedTags();
    
    await video.close();
    await tag.close();
    
    console.log('🗑️  Database cleared successfully');
    res.json({ success: true, message: 'Database cleared successfully' });
    
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    res.status(500).json({ error: 'Failed to clear database: ' + error.message });
  }
});

// 개발용 썸네일 폴더 정리 API
app.delete('/api/dev/clear-thumbnails', async (req, res) => {
  try {
    const thumbnailDir = path.join(__dirname, '../../thumbnails');
    
    // .gitkeep 파일 제외하고 모든 파일 삭제
    const files = await fs.readdir(thumbnailDir);
    for (const file of files) {
      if (file !== '.gitkeep') {
        await fs.remove(path.join(thumbnailDir, file));
      }
    }
    
    console.log('🗑️  Thumbnails cleared successfully');
    res.json({ success: true, message: 'Thumbnails cleared successfully' });
    
  } catch (error) {
    console.error('❌ Error clearing thumbnails:', error);
    res.status(500).json({ error: 'Failed to clear thumbnails: ' + error.message });
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`
🚀 Video Server is running!
   
   📺 Web Interface: http://localhost:${PORT}
   🔗 API Endpoint: http://localhost:${PORT}/api
   📁 Upload folder: ${path.join(__dirname, '../../uploads')}
   🖼️  Thumbnail folder: ${path.join(__dirname, '../../thumbnails')}
   
🎯 Ready for Phase 1 MVP testing!
  `);
});

// 종료 시 정리
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down server gracefully...');
  process.exit(0);
});