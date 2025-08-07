const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../../database/media.db');

class Video {
  constructor() {
    this.db = new sqlite3.Database(dbPath);
  }

  /**
   * 모든 비디오 조회 (태그 포함)
   */
  async getAllVideos() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          v.*,
          GROUP_CONCAT(t.name) as tags,
          GROUP_CONCAT(t.color) as tag_colors,
          GROUP_CONCAT(t.id) as tag_ids
        FROM videos v
        LEFT JOIN video_tags vt ON v.id = vt.video_id
        LEFT JOIN tags t ON vt.tag_id = t.id
        GROUP BY v.id
        ORDER BY v.created_at DESC
      `;
      
      this.db.all(query, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        // 태그 정보 파싱 및 썸네일 URL 생성
        const videos = rows.map(row => ({
          ...row,
          tags: row.tags ? row.tags.split(',') : [],
          tag_colors: row.tag_colors ? row.tag_colors.split(',') : [],
          tag_ids: row.tag_ids ? row.tag_ids.split(',').map(id => parseInt(id)) : [],
          thumbnail_url: row.thumbnail_path ? `/thumbnails/${path.basename(row.thumbnail_path)}` : null
        }));
        
        resolve(videos);
      });
    });
  }

  /**
   * ID로 비디오 조회
   */
  async getVideoById(id) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          v.*,
          GROUP_CONCAT(t.name) as tags,
          GROUP_CONCAT(t.color) as tag_colors,
          GROUP_CONCAT(t.id) as tag_ids
        FROM videos v
        LEFT JOIN video_tags vt ON v.id = vt.video_id
        LEFT JOIN tags t ON vt.tag_id = t.id
        WHERE v.id = ?
        GROUP BY v.id
      `;
      
      this.db.get(query, [id], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!row) {
          resolve(null);
          return;
        }
        
        const video = {
          ...row,
          tags: row.tags ? row.tags.split(',') : [],
          tag_colors: row.tag_colors ? row.tag_colors.split(',') : [],
          tag_ids: row.tag_ids ? row.tag_ids.split(',').map(id => parseInt(id)) : [],
          thumbnail_url: row.thumbnail_path ? `/thumbnails/${path.basename(row.thumbnail_path)}` : null
        };
        
        resolve(video);
      });
    });
  }

  /**
   * 새 비디오 추가
   */
  async addVideo(videoData) {
    return new Promise((resolve, reject) => {
      const {
        filename, title, file_path, file_size,
        duration, width, height, thumbnail_path, preview_path
      } = videoData;

      const query = `
        INSERT INTO videos (
          filename, title, file_path, file_size,
          duration, width, height, thumbnail_path, preview_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(query, [
        filename, title, file_path, file_size,
        duration, width, height, thumbnail_path, preview_path
      ], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.lastID);
      });
    });
  }

  /**
   * 비디오 정보 업데이트
   */
  async updateVideo(id, videoData) {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];
      
      Object.keys(videoData).forEach(key => {
        if (videoData[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(videoData[key]);
        }
      });
      
      if (fields.length === 0) {
        resolve(false);
        return;
      }
      
      values.push(id);
      const query = `UPDATE videos SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      
      this.db.run(query, values, function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      });
    });
  }

  /**
   * 비디오 삭제
   */
  async deleteVideo(id) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM videos WHERE id = ?', [id], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      });
    });
  }

  /**
   * 태그로 비디오 검색 (단일 태그)
   */
  async searchByTag(tagName) {
    return this.searchByTags([tagName]);
  }

  /**
   * 다중 태그로 비디오 검색 (AND 조건)
   */
  async searchByTags(tagNames) {
    return new Promise((resolve, reject) => {
      if (!tagNames || tagNames.length === 0) {
        console.log('📭 No tags provided, returning empty result');
        resolve([]);
        return;
      }

      console.log(`🔍 Searching for multiple tags: [${tagNames.join(', ')}]`);
      
      // 각 태그가 모두 있는 비디오만 찾기 위한 쿼리
      const placeholders = tagNames.map(() => '?').join(',');
      const query = `
        SELECT DISTINCT v.*,
          GROUP_CONCAT(t.name) as tags,
          GROUP_CONCAT(t.color) as tag_colors,
          GROUP_CONCAT(t.id) as tag_ids
        FROM videos v
        LEFT JOIN video_tags vt ON v.id = vt.video_id
        LEFT JOIN tags t ON vt.tag_id = t.id
        WHERE v.id IN (
          SELECT vt2.video_id 
          FROM video_tags vt2
          JOIN tags t2 ON vt2.tag_id = t2.id
          WHERE t2.name IN (${placeholders})
          GROUP BY vt2.video_id
          HAVING COUNT(DISTINCT t2.name) = ?
        )
        GROUP BY v.id
        ORDER BY v.created_at DESC
      `;
      
      // 파라미터: 태그 이름들 + 태그 개수
      const params = [...tagNames, tagNames.length];
      
      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error(`❌ Database error searching for tags [${tagNames.join(', ')}]:`, err);
          reject(err);
          return;
        }
        
        console.log(`📊 Found ${rows.length} videos with ALL tags: [${tagNames.join(', ')}]`);
        console.log(`📝 Raw rows:`, rows.map(r => ({ id: r.id, title: r.title, tags: r.tags })));
        
        const videos = rows.map(row => ({
          ...row,
          tags: row.tags ? row.tags.split(',') : [],
          tag_colors: row.tag_colors ? row.tag_colors.split(',') : [],
          tag_ids: row.tag_ids ? row.tag_ids.split(',').map(id => parseInt(id)) : [],
          thumbnail_url: row.thumbnail_path ? `/thumbnails/${path.basename(row.thumbnail_path)}` : null
        }));
        
        console.log(`✅ Returning ${videos.length} processed videos`);
        resolve(videos);
      });
    });
  }

  /**
   * 제목으로 비디오 검색
   */
  async searchByTitle(title) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT v.*,
          GROUP_CONCAT(t.name) as tags,
          GROUP_CONCAT(t.color) as tag_colors,
          GROUP_CONCAT(t.id) as tag_ids
        FROM videos v
        LEFT JOIN video_tags vt ON v.id = vt.video_id
        LEFT JOIN tags t ON vt.tag_id = t.id
        WHERE v.title LIKE ? OR v.filename LIKE ?
        GROUP BY v.id
        ORDER BY v.created_at DESC
      `;
      
      const searchTerm = `%${title}%`;
      this.db.all(query, [searchTerm, searchTerm], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        const videos = rows.map(row => ({
          ...row,
          tags: row.tags ? row.tags.split(',') : [],
          tag_colors: row.tag_colors ? row.tag_colors.split(',') : [],
          tag_ids: row.tag_ids ? row.tag_ids.split(',').map(id => parseInt(id)) : [],
          thumbnail_url: row.thumbnail_path ? `/thumbnails/${path.basename(row.thumbnail_path)}` : null
        }));
        
        resolve(videos);
      });
    });
  }

  /**
   * 비디오에 태그 추가
   */
  async addTagToVideo(videoId, tagId) {
    return new Promise((resolve, reject) => {
      const query = 'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)';
      this.db.run(query, [videoId, tagId], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      });
    });
  }

  /**
   * 비디오에서 태그 제거
   */
  async removeTagFromVideo(videoId, tagId) {
    return new Promise((resolve, reject) => {
      const query = 'DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?';
      this.db.run(query, [videoId, tagId], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      });
    });
  }

  /**
   * 데이터베이스 연결 종료
   */
  close() {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        }
        resolve();
      });
    });
  }
}

module.exports = Video;