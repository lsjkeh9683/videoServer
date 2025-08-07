const path = require('path');
const fs = require('fs-extra');

// FFmpeg 조건부 로딩
let ffmpeg = null;
try {
  ffmpeg = require('fluent-ffmpeg');
  
  // Windows에서 FFmpeg 경로 설정
  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    
    try {
      // FFmpeg 경로 자동 탐지
      const ffmpegPath = execSync('where ffmpeg', { encoding: 'utf8' }).trim().split('\n')[0];
      const ffprobePath = execSync('where ffprobe', { encoding: 'utf8' }).trim().split('\n')[0];
      
      console.log(`🔍 Found FFmpeg at: ${ffmpegPath}`);
      console.log(`🔍 Found FFprobe at: ${ffprobePath}`);
      
      ffmpeg.setFfmpegPath(ffmpegPath);
      ffmpeg.setFfprobePath(ffprobePath);
    } catch (pathError) {
      console.warn('⚠️  Could not auto-detect FFmpeg paths, trying default:', pathError.message);
      // 폴백 경로들 시도
      const fallbackPaths = [
        'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'ffmpeg'
      ];
      
      for (const path of fallbackPaths) {
        try {
          ffmpeg.setFfmpegPath(path);
          ffmpeg.setFfprobePath(path.replace('ffmpeg', 'ffprobe'));
          break;
        } catch (e) {
          continue;
        }
      }
    }
  }
  
  console.log('✅ FFmpeg loaded successfully');
} catch (error) {
  console.warn('⚠️  FFmpeg not available for thumbnails:', error.message);
}

class ThumbnailGenerator {
  constructor(thumbnailDir) {
    this.thumbnailDir = thumbnailDir;
    this.ensureDirectory();
  }

  /**
   * 썸네일 디렉토리 존재 확인 및 생성
   */
  async ensureDirectory() {
    try {
      await fs.ensureDir(this.thumbnailDir);
      console.log(`📁 Thumbnail directory ready: ${this.thumbnailDir}`);
    } catch (error) {
      console.error('❌ Error creating thumbnail directory:', error);
    }
  }

  /**
   * 비디오 파일에서 썸네일 생성 (FFmpeg 없을 때 기본 썸네일 생성)
   * @param {string} videoPath - 비디오 파일 경로
   * @param {string} filename - 파일명 (확장자 포함)
   * @param {Object} options - 썸네일 생성 옵션
   * @returns {Promise<string>} 생성된 썸네일 파일 경로
   */
  async generateThumbnail(videoPath, filename, options = {}) {
    const {
      width = 320,
      height = 240,
      timemark = '00:00:10' // 10초 지점에서 썸네일 추출
    } = options;

    // 썸네일 파일명 생성 (확장자를 .jpg로 변경)
    const thumbnailFilename = this.getThumbnailFilename(filename);
    const thumbnailPath = path.join(this.thumbnailDir, thumbnailFilename);

    // 이미 썸네일이 존재하는 경우 재사용
    if (await fs.pathExists(thumbnailPath)) {
      console.log(`♻️  Using existing thumbnail: ${thumbnailFilename}`);
      return thumbnailPath;
    }

    return new Promise((resolve, reject) => {
      // FFmpeg가 없거나 로드되지 않은 경우 즉시 placeholder 생성
      if (!ffmpeg) {
        console.warn(`⚠️  FFmpeg not available for ${filename}, creating placeholder thumbnail`);
        this.createPlaceholderThumbnail(thumbnailPath, filename)
          .then(resolve)
          .catch(reject);
        return;
      }

      try {
        ffmpeg(videoPath)
          .seekInput(timemark)
          .frames(1)
          .size(`${width}x${height}`)
          .format('image2')
          .outputOptions(['-update', '1'])
          .output(thumbnailPath)
          .on('start', (commandLine) => {
            console.log(`🎬 Spawned FFmpeg with command: ${commandLine}`);
          })
          .on('end', () => {
            console.log(`✅ Thumbnail generated: ${thumbnailFilename}`);
            resolve(thumbnailPath);
          })
          .on('error', (err) => {
            console.warn(`⚠️  FFmpeg error for ${filename}: ${err.message}, creating placeholder thumbnail`);
            this.createPlaceholderThumbnail(thumbnailPath, filename)
              .then(resolve)
              .catch(reject);
          })
          .run();
      } catch (ffmpegError) {
        console.warn(`⚠️  FFmpeg execution error: ${ffmpegError.message}`);
        this.createPlaceholderThumbnail(thumbnailPath, filename)
          .then(resolve)
          .catch(reject);
      }
    });
  }

  /**
   * 미리보기 비디오 클립 생성 (마우스 오버용, FFmpeg 없을 때 null 반환)
   * @param {string} videoPath - 비디오 파일 경로
   * @param {string} filename - 파일명
   * @param {Object} options - 미리보기 생성 옵션
   * @returns {Promise<string|null>} 생성된 미리보기 파일 경로 또는 null
   */
  async generatePreview(videoPath, filename, options = {}) {
    console.log(`\n🎬 === PREVIEW GENERATION START ===`);
    console.log(`📁 Video path: ${videoPath}`);
    console.log(`🏷️  Filename: ${filename}`);
    console.log(`⚙️  FFmpeg available: ${!!ffmpeg}`);
    
    // 먼저 비디오 길이를 확인하여 적절한 시작점과 길이를 설정
    const videoDuration = await this.getVideoDuration(videoPath);
    console.log(`⏱️  Video duration for preview: ${videoDuration} seconds`);
    
    if (videoDuration === 0) {
      console.error(`❌ Cannot generate preview - video duration is 0`);
      return null;
    }
    
    // 안전한 시작 시간과 길이 계산
    let startTime, duration;
    
    if (videoDuration <= 30) {
      // 매우 짧은 비디오 (30초 이하): 처음 5초부터 최대 10초
      startTime = Math.min(2, videoDuration * 0.1); // 10% 지점 또는 최대 2초
      duration = Math.min(10, videoDuration - startTime - 1); // 마지막 1초는 남겨둠
    } else if (videoDuration <= 60) {
      // 짧은 비디오 (1분 이하): 15초부터 15초간
      startTime = 15;
      duration = Math.min(15, videoDuration - startTime - 5);
    } else {
      // 긴 비디오: 기존 로직
      startTime = Math.max(30, videoDuration * 0.2); // 20% 지점 또는 최소 30초
      duration = Math.min(20, Math.max(10, videoDuration * 0.3)); // 30%까지, 최소 10초, 최대 20초
      startTime = Math.min(startTime, videoDuration - duration - 5); // 끝에서 5초는 남겨둠
    }
    
    const {
      width = 480,
      height = 360
    } = options;
    
    // 최종 검증
    if (startTime < 0) startTime = 0;
    if (duration <= 0 || startTime + duration > videoDuration) {
      duration = Math.max(1, videoDuration - startTime - 1);
    }

    console.log(`📊 Preview settings calculated:`);
    console.log(`   Duration: ${duration}s (${duration/videoDuration*100}% of video)`);
    console.log(`   Start time: ${startTime}s`);
    console.log(`   Resolution: ${width}x${height}`);

    const previewFilename = this.getPreviewFilename(filename);
    const previewPath = path.join(this.thumbnailDir, previewFilename);
    console.log(`📄 Preview filename: ${previewFilename}`);
    console.log(`📍 Preview path: ${previewPath}`);

    // 이미 미리보기가 존재하는 경우 크기 확인 후 재사용
    if (await fs.pathExists(previewPath)) {
      const stats = await fs.stat(previewPath);
      if (stats.size > 1024) {
        console.log(`♻️  Using existing valid preview: ${previewFilename} (${stats.size} bytes)`);
        return previewPath;
      } else {
        console.log(`🗑️  Removing invalid existing preview (${stats.size} bytes)`);
        await fs.remove(previewPath);
      }
    }
    
    console.log(`🚀 Starting FFmpeg preview generation...`);

    return new Promise((resolve) => {
      // FFmpeg가 없거나 로드되지 않은 경우 즉시 null 반환
      if (!ffmpeg) {
        console.warn(`⚠️  FFmpeg not available for preview: ${filename}`);
        resolve(null);
        return;
      }

      try {
        console.log(`🎬 FFmpeg settings:`);
        console.log(`   Input: ${videoPath}`);
        console.log(`   Output: ${previewPath}`);
        console.log(`   Seek: ${startTime}s`);
        console.log(`   Duration: ${duration}s`);
        console.log(`   Size: ${width}x${height}`);
        
        ffmpeg(videoPath)
          .seekInput(startTime)
          .duration(duration)
          .size(`${width}x${height}`)
          .videoCodec('libx264')
          .audioCodec('aac')
          .format('mp4')
          .outputOptions([
            '-preset ultrafast', // 더 빠른 인코딩
            '-crf 23', // 더 좋은 품질
            '-movflags +faststart',
            '-avoid_negative_ts make_zero', // 타임스탬프 문제 방지
            '-fflags +genpts' // PTS 생성 강제
          ])
          .output(previewPath)
          .on('start', (commandLine) => {
            console.log(`🚀 FFmpeg preview command: ${commandLine}`);
          })
          .on('progress', (progress) => {
            console.log(`⏳ Preview progress: ${progress.percent || 'N/A'}% complete`);
          })
          .on('end', async () => {
            console.log(`✅ FFmpeg preview generation completed`);
            
            // 파일이 실제로 생성되었는지 확인
            const exists = await fs.pathExists(previewPath);
            console.log(`🔍 Preview file exists: ${exists}`);
            
            if (exists) {
              const stats = await fs.stat(previewPath);
              console.log(`📊 Preview file size: ${stats.size} bytes`);
              
              // 파일 크기가 너무 작으면 오류로 간주 (1KB 미만)
              if (stats.size < 1024) {
                console.error(`❌ Preview file too small (${stats.size} bytes) - likely corrupted`);
                try {
                  await fs.remove(previewPath);
                  console.log(`🗑️  Removed corrupted preview file`);
                } catch (removeError) {
                  console.warn(`⚠️  Could not remove corrupted file: ${removeError.message}`);
                }
                console.log(`❌ === PREVIEW GENERATION FAILED ===\n`);
                resolve(null);
              } else {
                console.log(`🎉 === PREVIEW GENERATION SUCCESS ===\n`);
                resolve(previewPath);
              }
            } else {
              console.error(`❌ Preview file not found after generation!`);
              console.log(`❌ === PREVIEW GENERATION FAILED ===\n`);
              resolve(null);
            }
          })
          .on('error', (err) => {
            console.error(`❌ FFmpeg preview error: ${err.message}`);
            console.error(`❌ FFmpeg stderr: ${err.stderr || 'No stderr'}`);
            console.log(`❌ === PREVIEW GENERATION FAILED ===\n`);
            resolve(null);
          })
          .run();
      } catch (ffmpegError) {
        console.warn(`⚠️  FFmpeg execution error for preview: ${ffmpegError.message}`);
        resolve(null);
      }
    });
  }

  /**
   * 비디오에서 여러 썸네일 생성 (타임라인용)
   * @param {string} videoPath - 비디오 파일 경로
   * @param {string} filename - 파일명
   * @param {number} count - 생성할 썸네일 개수
   * @returns {Promise<Array>} 생성된 썸네일 파일 경로 배열
   */
  async generateTimelineThumbnails(videoPath, filename, count = 5) {
    const duration = await this.getVideoDuration(videoPath);
    const interval = Math.floor(duration / (count + 1));
    const thumbnails = [];

    for (let i = 1; i <= count; i++) {
      const timemark = this.formatTime(interval * i);
      const thumbnailFilename = `timeline_${i}_${this.getThumbnailFilename(filename)}`;
      const thumbnailPath = path.join(this.thumbnailDir, thumbnailFilename);

      try {
        await this.generateSingleThumbnail(videoPath, thumbnailPath, timemark);
        thumbnails.push({
          path: thumbnailPath,
          timemark: timemark,
          index: i,
          timestamp: interval * i
        });
      } catch (error) {
        console.warn(`⚠️  Failed to generate timeline thumbnail ${i} for ${filename}`);
      }
    }

    return thumbnails;
  }

  /**
   * 사용자 선택용 썸네일 여러 개 생성
   * @param {string} videoPath - 비디오 파일 경로
   * @param {string} filename - 파일명
   * @param {number} count - 생성할 썸네일 개수 (기본값: 6)
   * @returns {Promise<Array>} 생성된 썸네일 정보 배열
   */
  async generateSelectionThumbnails(videoPath, filename, count = 6) {
    console.log(`\n🎯 === THUMBNAIL GENERATION START ===`);
    console.log(`📁 Video path: ${videoPath}`);
    console.log(`🏷️  Filename: ${filename}`);
    console.log(`📊 Count requested: ${count}`);
    console.log(`⚙️  FFmpeg available: ${!!ffmpeg}`);
    console.log(`📂 Thumbnail directory: ${this.thumbnailDir}`);
    
    if (!ffmpeg) {
      console.error(`❌ FFmpeg not available - aborting thumbnail generation`);
      return [];
    }

    // 비디오 파일이 존재하는지 확인
    const videoExists = await fs.pathExists(videoPath);
    console.log(`🔍 Video file exists: ${videoExists}`);
    
    if (!videoExists) {
      console.error(`❌ Video file not found at: ${videoPath}`);
      return [];
    }

    // 썸네일 디렉토리 확인 및 생성
    try {
      await fs.ensureDir(this.thumbnailDir);
      console.log(`📁 Thumbnail directory ready: ${this.thumbnailDir}`);
    } catch (error) {
      console.error(`❌ Cannot create thumbnail directory: ${error.message}`);
      return [];
    }

    console.log(`⏱️  Getting video duration for: ${filename}`);
    const duration = await this.getVideoDuration(videoPath);
    console.log(`⏱️  Video duration result: ${duration} seconds`);
    
    if (duration === 0 || isNaN(duration)) {
      console.error(`❌ Invalid video duration (${duration}) - trying fallback approach`);
      
      // Fallback: 비디오가 짧거나 duration을 읽을 수 없는 경우 고정 시점에서 썸네일 생성
      console.log(`🔄 Attempting fallback thumbnail generation...`);
      return await this.generateFallbackThumbnails(videoPath, filename, Math.min(count, 3));
    }

    const thumbnails = [];
    const interval = Math.floor(duration / (count + 1));
    console.log(`📊 Calculation: duration=${duration}, count=${count}, interval=${interval} seconds`);
    
    // 비디오가 매우 짧은 경우 (6개 썸네일을 만들기에 너무 짧음)
    if (interval <= 0) {
      console.warn(`⚠️  Video too short (${duration}s) for ${count} thumbnails - using fallback`);
      return await this.generateFallbackThumbnails(videoPath, filename, Math.min(count, Math.max(1, Math.floor(duration))));
    }
    
    // 매우 짧은 간격인 경우 (1초 미만) 최소 1초 간격으로 조정
    const finalInterval = Math.max(1, interval);
    const adjustedCount = Math.min(count, Math.floor(duration / finalInterval));
    
    if (adjustedCount !== count) {
      console.log(`📊 Adjusted thumbnail count: ${count} -> ${adjustedCount} (due to short video)`);
    }

    console.log(`🚀 Starting thumbnail generation loop...`);

    for (let i = 1; i <= adjustedCount; i++) {
      const timestamp = finalInterval * i;
      const timemark = this.formatTime(timestamp);
      const thumbnailFilename = `selection_${i}_${this.getThumbnailFilename(filename)}`;
      const thumbnailPath = path.join(this.thumbnailDir, thumbnailFilename);

      console.log(`\n📸 === THUMBNAIL ${i}/${adjustedCount} ===`);
      console.log(`   ⏰ Timestamp: ${timestamp}s (${timemark})`);
      console.log(`   📄 Filename: ${thumbnailFilename}`);
      console.log(`   📍 Path: ${thumbnailPath}`);

      try {
        // 이미 존재하는지 확인
        const exists = await fs.pathExists(thumbnailPath);
        console.log(`   🔍 File exists: ${exists}`);
        
        if (!exists) {
          console.log(`   🎬 Generating new thumbnail...`);
          await this.generateSingleThumbnail(videoPath, thumbnailPath, timemark, {
            width: 240,
            height: 180
          });
          console.log(`   ✅ Single thumbnail generation completed`);
        } else {
          console.log(`   ♻️  Using existing thumbnail`);
        }
        
        // 파일이 실제로 생성되었는지 확인
        const finalExists = await fs.pathExists(thumbnailPath);
        console.log(`   🔍 Final check - file exists: ${finalExists}`);
        
        if (finalExists) {
          const stats = await fs.stat(thumbnailPath);
          console.log(`   📊 File size: ${stats.size} bytes`);
          
          thumbnails.push({
            path: thumbnailPath,
            filename: thumbnailFilename,
            timemark: timemark,
            index: i,
            timestamp: timestamp,
            url: `/thumbnails/${thumbnailFilename}`
          });
          
          console.log(`   ✅ Thumbnail ${i} added to results`);
        } else {
          console.error(`   ❌ Thumbnail file not found after generation!`);
        }
      } catch (error) {
        console.error(`   ❌ Error generating thumbnail ${i}:`);
        console.error(`   ❌ Message: ${error.message}`);
        console.error(`   ❌ Stack: ${error.stack}`);
      }
    }

    console.log(`\n📈 === THUMBNAIL GENERATION COMPLETE ===`);
    console.log(`✅ Success: ${thumbnails.length}/${adjustedCount} thumbnails generated`);
    console.log(`📄 Results: ${thumbnails.map(t => t.filename).join(', ')}`);
    console.log(`🔗 URLs: ${thumbnails.map(t => t.url).join(', ')}`);
    console.log(`=== END THUMBNAIL GENERATION ===\n`);
    
    return thumbnails;
  }

  /**
   * Fallback 썸네일 생성 (duration을 읽을 수 없거나 매우 짧은 비디오용)
   */
  async generateFallbackThumbnails(videoPath, filename, count = 3) {
    console.log(`🔄 === FALLBACK THUMBNAIL GENERATION ===`);
    console.log(`📁 Video: ${filename}`);
    console.log(`📊 Fallback count: ${count}`);
    
    const thumbnails = [];
    const fallbackTimes = ['00:00:01', '00:00:03', '00:00:05']; // 1초, 3초, 5초
    
    for (let i = 0; i < Math.min(count, fallbackTimes.length); i++) {
      const timemark = fallbackTimes[i];
      const thumbnailFilename = `selection_${i + 1}_${this.getThumbnailFilename(filename)}`;
      const thumbnailPath = path.join(this.thumbnailDir, thumbnailFilename);
      
      console.log(`\n📸 === FALLBACK THUMBNAIL ${i + 1}/${count} ===`);
      console.log(`   ⏰ Fixed timemark: ${timemark}`);
      console.log(`   📄 Filename: ${thumbnailFilename}`);
      console.log(`   📍 Path: ${thumbnailPath}`);
      
      try {
        const exists = await fs.pathExists(thumbnailPath);
        console.log(`   🔍 File exists: ${exists}`);
        
        if (!exists) {
          console.log(`   🎬 Generating fallback thumbnail...`);
          await this.generateSingleThumbnail(videoPath, thumbnailPath, timemark, {
            width: 240,
            height: 180
          });
          console.log(`   ✅ Fallback thumbnail generation completed`);
        } else {
          console.log(`   ♻️  Using existing fallback thumbnail`);
        }
        
        const finalExists = await fs.pathExists(thumbnailPath);
        console.log(`   🔍 Final check - file exists: ${finalExists}`);
        
        if (finalExists) {
          const stats = await fs.stat(thumbnailPath);
          console.log(`   📊 File size: ${stats.size} bytes`);
          
          thumbnails.push({
            path: thumbnailPath,
            filename: thumbnailFilename,
            timemark: timemark,
            index: i + 1,
            timestamp: (i + 1) * 2, // 대략적인 timestamp
            url: `/thumbnails/${thumbnailFilename}`
          });
          
          console.log(`   ✅ Fallback thumbnail ${i + 1} added to results`);
        } else {
          console.error(`   ❌ Fallback thumbnail file not found after generation!`);
        }
      } catch (error) {
        console.error(`   ❌ Error generating fallback thumbnail ${i + 1}:`);
        console.error(`   ❌ Message: ${error.message}`);
        
        // 첫 번째 썸네일 생성에 실패하면 중단, 그 외에는 계속 진행
        if (i === 0) {
          console.error(`   ❌ First fallback thumbnail failed - aborting`);
          break;
        }
      }
    }
    
    console.log(`\n📈 === FALLBACK GENERATION COMPLETE ===`);
    console.log(`✅ Success: ${thumbnails.length}/${count} fallback thumbnails generated`);
    console.log(`📄 Results: ${thumbnails.map(t => t.filename).join(', ')}`);
    console.log(`=== END FALLBACK GENERATION ===\n`);
    
    return thumbnails;
  }

  /**
   * 단일 썸네일 생성 (내부용, FFmpeg 없을 때 실패)
   */
  generateSingleThumbnail(videoPath, outputPath, timemark, options = {}) {
    const { width = 320, height = 240 } = options;
    
    return new Promise((resolve, reject) => {
      if (!ffmpeg) {
        const error = new Error('FFmpeg not available');
        console.error(`❌ ${error.message}`);
        reject(error);
        return;
      }

      console.log(`🎬 FFmpeg command: ${videoPath} -> ${outputPath} at ${timemark} (${width}x${height})`);

      try {
        ffmpeg(videoPath)
          .seekInput(timemark)
          .frames(1)
          .size(`${width}x${height}`)
          .format('image2')
          .outputOptions(['-update', '1'])
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log(`🚀 FFmpeg started: ${commandLine}`);
          })
          .on('progress', (progress) => {
            console.log(`⏳ FFmpeg progress: ${JSON.stringify(progress)}`);
          })
          .on('end', () => {
            console.log(`✅ FFmpeg completed: ${outputPath}`);
            resolve();
          })
          .on('error', (error) => {
            console.error(`❌ FFmpeg error: ${error.message}`);
            console.error(`❌ FFmpeg stderr: ${error.stderr || 'No stderr'}`);
            reject(error);
          })
          .run();
      } catch (error) {
        console.error(`❌ FFmpeg execution error: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 비디오 길이 정보 추출 (FFmpeg 없을 때 0 반환)
   */
  getVideoDuration(videoPath) {
    return new Promise((resolve) => {
      if (!ffmpeg) {
        console.error(`❌ FFmpeg not available for duration: ${path.basename(videoPath)}`);
        resolve(0);
        return;
      }

      console.log(`\n🔍 === GETTING VIDEO DURATION ===`);
      console.log(`📁 Video path: ${videoPath}`);
      console.log(`🔍 File exists: ${require('fs').existsSync(videoPath)}`);

      try {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
          if (err) {
            console.error(`❌ FFprobe error details:`);
            console.error(`   Message: ${err.message}`);
            console.error(`   Code: ${err.code || 'No code'}`);
            console.error(`   Stderr: ${err.stderr || 'No stderr'}`);
            console.error(`   Stack: ${err.stack}`);
            resolve(0);
            return;
          }
          
          console.log(`📊 FFprobe successful - Raw metadata format:`);
          console.log(`   Duration: ${metadata.format?.duration} (type: ${typeof metadata.format?.duration})`);
          console.log(`   Format name: ${metadata.format?.format_name}`);
          console.log(`   Size: ${metadata.format?.size}`);
          console.log(`   Bit rate: ${metadata.format?.bit_rate}`);
          console.log(`   Streams count: ${metadata.streams?.length}`);
          
          if (metadata.streams && metadata.streams.length > 0) {
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (videoStream) {
              console.log(`🎬 Video stream info:`);
              console.log(`   Codec: ${videoStream.codec_name}`);
              console.log(`   Duration: ${videoStream.duration} (type: ${typeof videoStream.duration})`);
              console.log(`   Resolution: ${videoStream.width}x${videoStream.height}`);
              console.log(`   Frame rate: ${videoStream.r_frame_rate}`);
            }
          }
          
          // 다양한 방법으로 duration 추출 시도
          let duration = 0;
          
          if (metadata.format?.duration && !isNaN(metadata.format.duration)) {
            duration = Math.floor(parseFloat(metadata.format.duration));
            console.log(`✅ Duration from format: ${duration} seconds`);
          } else if (metadata.streams?.length > 0) {
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (videoStream?.duration && !isNaN(videoStream.duration)) {
              duration = Math.floor(parseFloat(videoStream.duration));
              console.log(`✅ Duration from video stream: ${duration} seconds`);
            }
          }
          
          console.log(`⏱️  Final extracted duration: ${duration} seconds`);
          console.log(`=== END VIDEO DURATION ===\n`);
          
          resolve(duration);
        });
      } catch (error) {
        console.error(`❌ FFprobe execution error: ${error.message}`);
        console.error(`❌ Stack: ${error.stack}`);
        resolve(0);
      }
    });
  }

  /**
   * 썸네일 파일명 생성
   * @param {string} originalFilename - 원본 파일명
   * @returns {string} 썸네일 파일명
   */
  getThumbnailFilename(originalFilename) {
    const name = path.parse(originalFilename).name;
    return `thumb_${name}.jpg`;
  }

  /**
   * 미리보기 파일명 생성
   * @param {string} originalFilename - 원본 파일명
   * @returns {string} 미리보기 파일명
   */
  getPreviewFilename(originalFilename) {
    const name = path.parse(originalFilename).name;
    return `preview_${name}.mp4`;
  }

  /**
   * 초 단위 시간을 HH:MM:SS 형식으로 변환
   * @param {number} seconds - 초
   * @returns {string} 포맷된 시간 문자열
   */
  formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * FFmpeg 없을 때 placeholder 썸네일 생성
   * @param {string} thumbnailPath - 썸네일 저장 경로
   * @param {string} filename - 원본 파일명
   */
  async createPlaceholderThumbnail(thumbnailPath, filename) {
    try {
      // SVG placeholder 생성
      const svgContent = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
        <rect width="320" height="240" fill="#2a2a2a"/>
        <text x="160" y="100" text-anchor="middle" fill="white" font-family="Arial" font-size="16">🎬</text>
        <text x="160" y="130" text-anchor="middle" fill="#aaa" font-family="Arial" font-size="12">Video File</text>
        <text x="160" y="150" text-anchor="middle" fill="#666" font-family="Arial" font-size="10">${path.parse(filename).name}</text>
        <text x="160" y="180" text-anchor="middle" fill="#444" font-family="Arial" font-size="8">FFmpeg not available</text>
      </svg>`;
      
      // SVG를 파일로 저장 (확장자를 .svg로)
      const svgPath = thumbnailPath.replace('.jpg', '.svg');
      await fs.writeFile(svgPath, svgContent);
      
      console.log(`📎 Placeholder thumbnail created: ${path.basename(svgPath)}`);
      return svgPath;
      
    } catch (error) {
      console.error('❌ Error creating placeholder thumbnail:', error);
      throw error;
    }
  }

  /**
   * 썸네일 파일 삭제
   * @param {string} filename - 원본 파일명
   */
  async deleteThumbnail(filename) {
    try {
      const thumbnailPath = path.join(this.thumbnailDir, this.getThumbnailFilename(filename));
      const previewPath = path.join(this.thumbnailDir, this.getPreviewFilename(filename));
      const svgPath = thumbnailPath.replace('.jpg', '.svg');
      
      await Promise.all([
        fs.remove(thumbnailPath).catch(() => {}),
        fs.remove(previewPath).catch(() => {}),
        fs.remove(svgPath).catch(() => {})
      ]);
      
      console.log(`🗑️  Thumbnails deleted for: ${filename}`);
    } catch (error) {
      console.error('❌ Error deleting thumbnails:', error);
    }
  }
}

module.exports = ThumbnailGenerator;