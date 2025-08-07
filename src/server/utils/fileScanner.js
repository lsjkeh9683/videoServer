const fs = require('fs-extra');
const path = require('path');

// FFmpeg 조건부 로딩
let ffmpeg = null;
try {
  ffmpeg = require('fluent-ffmpeg');
} catch (error) {
  console.warn('⚠️  FFmpeg not available:', error.message);
}

class FileScanner {
  constructor() {
    this.supportedFormats = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'];
  }

  /**
   * 지정된 디렉토리에서 비디오 파일을 재귀적으로 스캔
   * @param {string} directory - 스캔할 디렉토리 경로
   * @returns {Promise<Array>} 발견된 비디오 파일 배열
   */
  async scanDirectory(directory) {
    try {
      const files = [];
      await this._scanRecursive(directory, files);
      console.log(`📁 Scanned ${directory}: Found ${files.length} video files`);
      return files;
    } catch (error) {
      console.error('❌ Error scanning directory:', error);
      throw error;
    }
  }

  /**
   * 재귀적으로 디렉토리를 스캔하는 내부 메서드
   */
  async _scanRecursive(directory, files) {
    try {
      const items = await fs.readdir(directory);
      
      for (const item of items) {
        const fullPath = path.join(directory, item);
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory()) {
          // 하위 디렉토리 재귀 스캔
          await this._scanRecursive(fullPath, files);
        } else if (stat.isFile()) {
          // 비디오 파일인지 확인
          const ext = path.extname(item).toLowerCase();
          if (this.supportedFormats.includes(ext)) {
            const fileInfo = {
              filename: item,
              file_path: fullPath,
              file_size: stat.size,
              created_at: stat.birthtime,
              modified_at: stat.mtime
            };
            
            // 비디오 메타데이터 추출
            try {
              const metadata = await this.getVideoMetadata(fullPath);
              fileInfo.duration = metadata.duration;
              fileInfo.width = metadata.width;
              fileInfo.height = metadata.height;
              fileInfo.title = this.extractTitle(item);
            } catch (metaError) {
              console.warn(`⚠️  Could not extract metadata for ${item}:`, metaError.message);
              fileInfo.title = this.extractTitle(item);
            }
            
            files.push(fileInfo);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error reading directory ${directory}:`, error.message);
    }
  }

  /**
   * FFmpeg를 사용하여 비디오 메타데이터 추출 (FFmpeg 없을 때 기본값 반환)
   * @param {string} filePath - 비디오 파일 경로
   * @returns {Promise<Object>} 메타데이터 객체
   */
  getVideoMetadata(filePath) {
    return new Promise((resolve) => {
      // FFmpeg가 없거나 로드되지 않은 경우 기본값 반환
      if (!ffmpeg) {
        console.warn(`⚠️  FFmpeg not available, using default metadata for: ${path.basename(filePath)}`);
        resolve({
          duration: 0,
          width: 1920,
          height: 1080,
          bitrate: 0,
          format: 'unknown'
        });
        return;
      }

      try {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            console.warn(`⚠️  FFmpeg error, using default metadata for: ${path.basename(filePath)}`);
            resolve({
              duration: 0,
              width: 1920,
              height: 1080,
              bitrate: 0,
              format: 'unknown'
            });
            return;
          }

          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
          
          if (!videoStream) {
            resolve({
              duration: 0,
              width: 1920,
              height: 1080,
              bitrate: 0,
              format: 'unknown'
            });
            return;
          }

          resolve({
            duration: Math.round(metadata.format.duration || 0),
            width: videoStream.width || 1920,
            height: videoStream.height || 1080,
            bitrate: metadata.format.bit_rate || 0,
            format: metadata.format.format_name || 'unknown'
          });
        });
      } catch (ffmpegError) {
        console.warn(`⚠️  FFmpeg execution error: ${ffmpegError.message}`);
        resolve({
          duration: 0,
          width: 1920,
          height: 1080,
          bitrate: 0,
          format: 'unknown'
        });
      }
    });
  }

  /**
   * 파일명에서 제목 추출 (확장자 제거, 특수문자 정리)
   * @param {string} filename - 파일명
   * @returns {string} 정리된 제목
   */
  extractTitle(filename) {
    return path.parse(filename).name
      .replace(/[._-]/g, ' ')  // 특수문자를 공백으로
      .replace(/\s+/g, ' ')    // 연속 공백을 하나로
      .trim();
  }

  /**
   * 파일 크기를 사람이 읽기 쉬운 형태로 변환
   * @param {number} bytes - 바이트 크기
   * @returns {string} 포맷된 크기 문자열
   */
  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * 지원되는 비디오 형식인지 확인
   * @param {string} filePath - 파일 경로
   * @returns {boolean} 지원 여부
   */
  isVideoFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.includes(ext);
  }
}

module.exports = FileScanner;