const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../../database/media.db');

class Tag {
  constructor() {
    this.db = new sqlite3.Database(dbPath);
  }

  /**
   * 모든 태그 조회 (계층적 구조 포함)
   */
  async getAllTags() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*, COUNT(vt.video_id) as video_count
        FROM tags t
        LEFT JOIN video_tags vt ON t.id = vt.tag_id
        GROUP BY t.id
        ORDER BY t.level ASC, t.category ASC, t.name ASC
      `;
      
      this.db.all(query, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  /**
   * ID로 태그 조회
   */
  async getTagById(id) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*, COUNT(vt.video_id) as video_count
        FROM tags t
        LEFT JOIN video_tags vt ON t.id = vt.tag_id
        WHERE t.id = ?
        GROUP BY t.id
      `;
      
      this.db.get(query, [id], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row);
      });
    });
  }

  /**
   * 이름으로 태그 조회 (대소문자 구분 없음)
   */
  async getTagByName(name) {
    return new Promise((resolve, reject) => {
      console.log(`🔍 Searching for tag with name: "${name}"`);
      const query = 'SELECT * FROM tags WHERE LOWER(name) = LOWER(?)';
      this.db.get(query, [name], (err, row) => {
        if (err) {
          console.error(`❌ Error searching for tag "${name}":`, err);
          reject(err);
          return;
        }
        if (row) {
          console.log(`✅ Found tag: ID=${row.id}, name="${row.name}"`);
        } else {
          console.log(`❌ No tag found with name: "${name}"`);
        }
        resolve(row);
      });
    });
  }

  /**
   * 새 태그 생성 (계층적 구조 지원)
   */
  async createTag(name, color = '#007bff', parentId = null, category = 'custom', level = 1) {
    return new Promise((resolve, reject) => {
      console.log(`➕ Creating new tag: "${name}" with color ${color}, parent: ${parentId}, category: ${category}, level: ${level}`);
      const query = 'INSERT INTO tags (name, color, parent_id, category, level) VALUES (?, ?, ?, ?, ?)';
      this.db.run(query, [name, color, parentId, category, level], function(err) {
        if (err) {
          // UNIQUE 제약 조건 위반 시 (이미 존재하는 태그)
          if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            console.error(`❌ Tag "${name}" already exists (UNIQUE constraint)`);
            reject(new Error(`Tag "${name}" already exists`));
            return;
          }
          console.error(`❌ Error creating tag "${name}":`, err);
          reject(err);
          return;
        }
        console.log(`✅ Successfully created tag "${name}" with ID: ${this.lastID}`);
        resolve(this.lastID);
      });
    });
  }

  /**
   * 태그 업데이트 (계층적 구조 지원)
   */
  async updateTag(id, name, color, category = null) {
    return new Promise((resolve, reject) => {
      let query, params;
      
      if (category) {
        query = 'UPDATE tags SET name = ?, color = ?, category = ? WHERE id = ?';
        params = [name, color, category, id];
      } else {
        query = 'UPDATE tags SET name = ?, color = ? WHERE id = ?';
        params = [name, color, id];
      }
      
      this.db.run(query, params, function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      });
    });
  }

  /**
   * 태그 삭제
   */
  async deleteTag(id) {
    return new Promise((resolve, reject) => {
      // 태그 삭제 시 관련 video_tags도 자동 삭제됨 (CASCADE)
      const query = 'DELETE FROM tags WHERE id = ?';
      this.db.run(query, [id], function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes > 0);
      });
    });
  }

  /**
   * 태그 이름으로 검색
   */
  async searchTags(searchTerm) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*, COUNT(vt.video_id) as video_count
        FROM tags t
        LEFT JOIN video_tags vt ON t.id = vt.tag_id
        WHERE t.name LIKE ?
        GROUP BY t.id
        ORDER BY t.name ASC
      `;
      
      this.db.all(query, [`%${searchTerm}%`], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  /**
   * 특정 비디오의 태그들 조회
   */
  async getTagsByVideoId(videoId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*
        FROM tags t
        JOIN video_tags vt ON t.id = vt.tag_id
        WHERE vt.video_id = ?
        ORDER BY t.name ASC
      `;
      
      this.db.all(query, [videoId], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  /**
   * 태그가 존재하지 않으면 생성하고 ID 반환
   */
  async findOrCreateTag(name, color = '#007bff') {
    try {
      console.log(`🔍 Looking for existing tag: "${name}"`);
      const existingTag = await this.getTagByName(name);
      if (existingTag) {
        console.log(`✅ Found existing tag: ID=${existingTag.id}, name="${existingTag.name}"`);
        return existingTag.id;
      }
      
      console.log(`➕ Creating new tag: "${name}" with color ${color}`);
      const newTagId = await this.createTag(name, color);
      console.log(`✅ Created new tag with ID: ${newTagId}`);
      return newTagId;
    } catch (error) {
      console.error(`❌ Error in findOrCreateTag for "${name}":`, error);
      throw error;
    }
  }

  /**
   * 인기 태그 조회 (비디오 수 기준)
   */
  async getPopularTags(limit = 10) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*, COUNT(vt.video_id) as video_count
        FROM tags t
        JOIN video_tags vt ON t.id = vt.tag_id
        GROUP BY t.id
        ORDER BY video_count DESC, t.name ASC
        LIMIT ?
      `;
      
      this.db.all(query, [limit], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  /**
   * 사용되지 않는 태그들 조회
   */
  async getUnusedTags() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*
        FROM tags t
        LEFT JOIN video_tags vt ON t.id = vt.tag_id
        WHERE vt.tag_id IS NULL
        ORDER BY t.name ASC
      `;
      
      this.db.all(query, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  /**
   * 사용되지 않는 태그들 일괄 삭제
   */
  async cleanupUnusedTags() {
    return new Promise((resolve, reject) => {
      const query = `
        DELETE FROM tags 
        WHERE id NOT IN (
          SELECT DISTINCT tag_id FROM video_tags
        )
      `;
      
      this.db.run(query, function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this.changes);
      });
    });
  }

  /**
   * 계층적 태그 구조 조회
   */
  async getHierarchicalTags() {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*, COUNT(vt.video_id) as video_count,
               p.name as parent_name, p.color as parent_color
        FROM tags t
        LEFT JOIN video_tags vt ON t.id = vt.tag_id
        LEFT JOIN tags p ON t.parent_id = p.id
        GROUP BY t.id
        ORDER BY t.level ASC, t.category ASC, t.name ASC
      `;
      
      this.db.all(query, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        // 계층적 구조로 변환
        const hierarchy = this.buildTagHierarchy(rows);
        resolve(hierarchy);
      });
    });
  }

  /**
   * 태그 계층 구조 빌드
   */
  buildTagHierarchy(tags) {
    const tagMap = new Map();
    const rootTags = [];
    
    // 먼저 모든 태그를 맵에 저장
    tags.forEach(tag => {
      tag.children = [];
      tagMap.set(tag.id, tag);
    });
    
    // 부모-자식 관계 설정
    tags.forEach(tag => {
      if (tag.parent_id) {
        const parent = tagMap.get(tag.parent_id);
        if (parent) {
          parent.children.push(tag);
        }
      } else {
        rootTags.push(tag);
      }
    });
    
    return {
      flat: tags,
      hierarchical: rootTags
    };
  }

  /**
   * 카테고리별 태그 조회
   */
  async getTagsByCategory(category) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*, COUNT(vt.video_id) as video_count
        FROM tags t
        LEFT JOIN video_tags vt ON t.id = vt.tag_id
        WHERE t.category = ?
        GROUP BY t.id
        ORDER BY t.name ASC
      `;
      
      this.db.all(query, [category], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  /**
   * 태그의 하위 태그들 조회
   */
  async getChildTags(parentId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT t.*, COUNT(vt.video_id) as video_count
        FROM tags t
        LEFT JOIN video_tags vt ON t.id = vt.tag_id
        WHERE t.parent_id = ?
        GROUP BY t.id
        ORDER BY t.name ASC
      `;
      
      this.db.all(query, [parentId], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
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

module.exports = Tag;