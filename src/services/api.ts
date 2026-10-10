/**
 * API Service Client
 * Handles communication with backend and client data services,
 * structured 1:1 with Supabase client (@supabase/supabase-js).
 */
import * as tus from 'tus-js-client';
import { supabase } from '../lib/supabaseClient';
import {
  AuthSession,
  Course,
  Subject,
  Chapter,
  Lesson,
  Announcement,
  AdminStats,
  UserProfile,
} from '../types';

const TOKEN_STORAGE_KEY = 'chempoint_lms_auth_token';
const USER_STORAGE_KEY = 'chempoint_lms_auth_user';

export function getStoredToken(): string | null {
  const directToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (directToken && directToken !== 'undefined' && directToken !== 'null') {
    return directToken;
  }

  // Check Supabase custom storage key: chempoint_sb_auth_token
  const sbAuth = localStorage.getItem('chempoint_sb_auth_token');
  if (sbAuth) {
    try {
      const parsed = JSON.parse(sbAuth);
      if (parsed?.access_token) return parsed.access_token;
      if (parsed?.currentSession?.access_token) return parsed.currentSession.access_token;
    } catch {}
  }

  // Check standard Supabase storage keys (e.g. sb-*-auth-token)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('sb-') || key.includes('auth-token') || key.includes('supabase.auth'))) {
      try {
        const val = localStorage.getItem(key);
        if (val) {
          const parsed = JSON.parse(val);
          if (parsed?.access_token) return parsed.access_token;
        }
      } catch {}
    }
  }

  return localStorage.getItem('apex_lms_auth_token') || null;
}

export function getStoredUser(): UserProfile | null {
  const userStr = localStorage.getItem(USER_STORAGE_KEY) || localStorage.getItem('apex_lms_auth_user');
  if (!userStr || userStr === 'undefined' || userStr === 'null') return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

export function setStoredSession(session: AuthSession | null) {
  if (session && session.token && session.user) {
    localStorage.setItem(TOKEN_STORAGE_KEY, session.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem('apex_lms_auth_token');
    localStorage.removeItem('apex_lms_auth_user');
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token = getStoredToken();
  if (!token) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) {
        token = data.session.access_token;
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      }
    } catch {}
  }
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  const isHtml = contentType.toLowerCase().includes('text/html');

  if (isHtml) {
    if (!response.ok) {
      throw new Error(`API endpoint unavailable (HTTP ${response.status}).`);
    }
    // If status 200 but content is HTML (SPA rewrite catch-all returned index.html)
    throw new Error(`API returned HTML instead of JSON. The backend server might not be running.`);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      console.warn('[ChemPoint API] 401 Unauthorized for endpoint:', endpoint);
    }
    const errorMsg =
      data?.error ||
      data?.message ||
      (response.status === 403
        ? 'Access denied. You do not have permission to access this resource.'
        : response.status === 401
        ? 'Please sign in to access this classroom resource.'
        : `Request failed with status ${response.status}`);
    throw new Error(errorMsg);
  }

  return data as T;
}

export const api = {
  // 1. Auth API
  auth: {
    async login(email: string, password: string, portal?: 'student' | 'admin'): Promise<AuthSession> {
      const res = await request<AuthSession>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, portal }),
      });
      if (!res?.user || !res?.token) {
        throw new Error('Invalid authentication response from server.');
      }
      setStoredSession(res);
      return res;
    },

    async register(data: {
      email: string;
      password: string;
      full_name: string;
      phone?: string;
      batch_name?: string;
      target_exam?: string;
    }): Promise<AuthSession> {
      const res = await request<AuthSession>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!res?.user || !res?.token) {
        throw new Error('Invalid registration response from server.');
      }
      setStoredSession(res);
      return res;
    },

    async resetPassword(email: string): Promise<{ message: string }> {
      return request<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    },

    async getCurrentUser(): Promise<UserProfile> {
      const res = await request<{ user: UserProfile }>('/api/auth/me');
      if (!res?.user) {
        throw new Error('User profile could not be loaded.');
      }
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(res.user));
      return res.user;
    },

    async updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
      const res = await request<{ user: UserProfile }>('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(res.user));
      return res.user;
    },

    async changePassword(data: {
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    }): Promise<{ message: string }> {
      return request<{ message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async changeEmail(data: {
      newEmail: string;
      currentPassword: string;
    }): Promise<{ message: string; user?: UserProfile; token?: string }> {
      const res = await request<{ message: string; user: UserProfile; token: string }>(
        '/api/auth/change-email',
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
      if (res.user && res.token) {
        setStoredSession({ token: res.token, user: res.user });
      }
      return res;
    },

    logout() {
      setStoredSession(null);
    },
  },

  // 2. Courses API
  courses: {
    async list(enrolledOnly = false): Promise<Course[]> {
      const query = enrolledOnly ? '?enrolled=true' : '';
      return request<Course[]>("/api/courses" + query);
    },

    async getById(id: string): Promise<Course> {
      return request<Course>(`/api/courses/${id}`);
    },

    async create(data: Partial<Course>): Promise<Course> {
      return request<Course>('/api/courses', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async update(id: string, data: Partial<Course>): Promise<Course> {
      return request<Course>(`/api/courses/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    async delete(id: string): Promise<{ message: string }> {
      return request<{ message: string }>(`/api/courses/${id}`, {
        method: 'DELETE',
      });
    },
  },

  // 3. Subjects API
  subjects: {
    async create(data: { course_id: string; title: string; sort_order?: number }): Promise<Subject> {
      return request<Subject>('/api/subjects', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async update(id: string, data: { title?: string; sort_order?: number }): Promise<Subject> {
      return request<Subject>(`/api/subjects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    async delete(id: string): Promise<{ message: string }> {
      return request<{ message: string }>(`/api/subjects/${id}`, {
        method: 'DELETE',
      });
    },
  },

  // 4. Chapters API
  chapters: {
    async create(data: {
      subject_id: string;
      title: string;
      chapter_number: number;
    }): Promise<Chapter> {
      return request<Chapter>('/api/chapters', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async update(
      id: string,
      data: { title?: string; chapter_number?: number }
    ): Promise<Chapter> {
      return request<Chapter>(`/api/chapters/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    async delete(id: string): Promise<{ message: string }> {
      return request<{ message: string }>(`/api/chapters/${id}`, {
        method: 'DELETE',
      });
    },
  },

  // 5. Lessons API
  lessons: {
    async getById(id: string): Promise<Lesson> {
      return request<Lesson>(`/api/lessons/${id}`);
    },

    async create(data: {
      chapter_id: string;
      title: string;
      description?: string;
      video_url?: string;
      pdf_url?: string;
      duration_minutes?: number;
      lesson_order?: number;
      is_published?: boolean;
    }): Promise<Lesson> {
      return request<Lesson>('/api/lessons', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async update(id: string, data: Partial<Lesson>): Promise<Lesson> {
      return request<Lesson>(`/api/lessons/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },

    async togglePublish(id: string): Promise<{ is_published: boolean }> {
      return request<{ is_published: boolean }>(`/api/lessons/${id}/toggle-publish`, {
        method: 'POST',
      });
    },

    async delete(id: string): Promise<{ message: string }> {
      return request<{ message: string }>(`/api/lessons/${id}`, {
        method: 'DELETE',
      });
    },

    async addMaterial(
      lessonId: string,
      data: {
        title: string;
        url: string;
        file_name?: string;
        file_size?: string;
        file_type?: string;
      }
    ): Promise<Lesson> {
      return request<Lesson>(`/api/lessons/${lessonId}/materials`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async uploadMaterialFile(file: File, onProgress?: (percent: number) => void): Promise<{
      url: string;
      fileName: string;
      fileSize: string;
      fileType: string;
      storage: 'supabase' | 'local';
    }> {
      const formData = new FormData();
      formData.append('file', file);

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload/material');

        const token = getStoredToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            onProgress(percentComplete);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const res = JSON.parse(xhr.responseText);
              resolve(res);
            } catch {
              reject(new Error('Invalid response from upload server'));
            }
          } else {
            try {
              const errRes = JSON.parse(xhr.responseText);
              reject(new Error(errRes.error || `Upload failed with status ${xhr.status}`));
            } catch {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error during file upload. Please check your connection.'));
        };

        xhr.send(formData);
      });
    },

    // 1. Get Resumable TUS Upload Target from server
    async getResumableUploadTarget(params: {
      lessonId: string;
      fileName: string;
      fileSize: number;
      fileType: string;
      contentType: string;
    }) {
      return request<{
        resumable: boolean;
        endpoint: string;
        storagePath: string;
        publicUrl: string;
        token?: string;
        anonKey?: string;
        bucket?: string;
        fileName: string;
        fileSizeStr: string;
        fileType: string;
        fallback?: boolean;
      }>('/api/upload/resumable-target', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    // 2. Confirm material upload
    async confirmMaterialUpload(params: {
      lessonId: string;
      storagePath: string;
      title: string;
      fileName: string;
      fileSize: string;
      fileSizeBytes?: number;
      fileType: string;
    }) {
      return request<{
        success: boolean;
        material: any;
      }>('/api/upload/confirm-material', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    // 3. Full high-level Resumable / TUS upload directly to Supabase Storage
    async uploadStudyMaterialResumable(params: {
      file: File;
      lessonId: string;
      title?: string;
      onProgress?: (percent: number, bytesUploaded: number, bytesTotal: number) => void;
      onStatusChange?: (status: string) => void;
      registerCancel?: (cancelFn: () => void) => void;
    }): Promise<{
      url: string;
      fileName: string;
      fileSize: string;
      fileType: string;
      storage: 'supabase' | 'local';
      material?: any;
    }> {
      const { file, lessonId, title, onProgress, onStatusChange, registerCancel } = params;

      const MAX_SIZE = 50 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        throw new Error(
          `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 50 MB direct cloud storage limit. Please compress your PDF or use the "External Link" option for larger materials.`
        );
      }

      onStatusChange?.('Requesting authorized upload target...');

      const target = await api.lessons.getResumableUploadTarget({
        lessonId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.name.split('.').pop()?.toLowerCase() || 'pdf',
        contentType: file.type || 'application/pdf',
      });

      if (target.fallback || !target.token) {
        onStatusChange?.('Uploading via persistent server fallback...');
        return api.lessons.uploadMaterialFile(file, (pct) => {
          onProgress?.(pct, (pct / 100) * file.size, file.size);
        });
      }

      onStatusChange?.('Uploading 0%');
      if (onProgress) onProgress(0, 0, file.size);

      return new Promise((resolve, reject) => {
        let isAborted = false;
        const upload = new tus.Upload(file, {
          endpoint: target.endpoint,
          retryDelays: [0, 1000, 3000, 5000],
          headers: {
            apikey: target.anonKey || '',
            'x-signature': target.token,
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: target.bucket || 'study-materials',
            objectName: target.storagePath,
            contentType: file.type || 'application/pdf',
            cacheControl: '3600',
          },
          chunkSize: 6 * 1024 * 1024,
          onError: (err) => {
            if (isAborted) return;
            console.error('[ChemPoint TUS Error Diagnostics]', {
              error: err,
              fileName: file.name,
              fileSize: file.size,
              endpoint: target.endpoint,
            });
            reject(
              new Error(
                `Upload to cloud storage failed: ${err.message || 'Connection lost'}. Please check your connection and try again.`
              )
            );
          },
          onProgress: (bytesUploaded, bytesTotal) => {
            if (isAborted) return;
            const percent = Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100));
            onProgress?.(percent, bytesUploaded, bytesTotal);
            onStatusChange?.(
              `Uploading ${percent}% (${(bytesUploaded / (1024 * 1024)).toFixed(1)} MB / ${(bytesTotal / (1024 * 1024)).toFixed(1)} MB)`
            );
          },
          onSuccess: async () => {
            if (isAborted) return;
            try {
              onProgress?.(100, file.size, file.size);
              onStatusChange?.('Uploading 100% – Finalizing & verifying storage...');
              const confirmRes = await api.lessons.confirmMaterialUpload({
                lessonId,
                storagePath: target.storagePath,
                title: title?.trim() || target.fileName,
                fileName: target.fileName,
                fileSize: target.fileSizeStr || `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
                fileSizeBytes: file.size,
                fileType: target.fileType,
              });
              onStatusChange?.('Uploaded successfully');
              resolve({
                url: target.publicUrl || confirmRes.material?.url,
                fileName: target.fileName,
                fileSize: target.fileSizeStr || `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
                fileType: target.fileType,
                storage: 'supabase',
                material: confirmRes.material,
              });
            } catch (confirmErr: any) {
              console.error('[ChemPoint DB Confirmation Failure]', confirmErr);
              reject(confirmErr);
            }
          },
        });

        if (registerCancel) {
          registerCancel(() => {
            isAborted = true;
            try {
              upload.abort();
            } catch (e) {
              console.warn('TUS abort error:', e);
            }
            reject(new Error('Upload canceled by user.'));
          });
        }

        upload.start();
      });
    },

    async deleteMaterial(lessonId: string, materialId: string): Promise<{ message: string }> {
      return request<{ message: string }>(`/api/lessons/${lessonId}/materials/${materialId}`, {
        method: 'DELETE',
      });
    },

    async updateProgress(
      lessonId: string,
      data: { completed?: boolean; last_watched_second?: number }
    ): Promise<{ completed: boolean; last_watched_second: number }> {
      return request<{ completed: boolean; last_watched_second: number }>(
        `/api/lessons/${lessonId}/progress`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
    },
  },

  // 6. Admin Students & Access Control API
  students: {
    async list(): Promise<
      (UserProfile & {
        enrolled_courses: { id: string; title: string; code: string }[];
        enrolled_course_ids: string[];
        completed_lessons_count: number;
      })[]
    > {
      return request('/api/students');
    },

    async updateAccess(
      studentId: string,
      courseId: string,
      action: 'enroll' | 'revoke'
    ): Promise<{ message: string; enrolled_course_ids: string[] }> {
      return request(`/api/students/${studentId}/access`, {
        method: 'POST',
        body: JSON.stringify({ course_id: courseId, action }),
      });
    },
  },

  // 7. Announcements API
  announcements: {
    async list(): Promise<Announcement[]> {
      return request<Announcement[]>('/api/announcements');
    },

    async create(data: {
      title: string;
      content: string;
      course_id?: string | null;
      priority?: 'normal' | 'urgent' | 'highlight';
    }): Promise<Announcement> {
      return request<Announcement>('/api/announcements', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async delete(id: string): Promise<{ message: string }> {
      return request<{ message: string }>(`/api/announcements/${id}`, {
        method: 'DELETE',
      });
    },
  },

  // 8. Admin Dashboard Stats
  admin: {
    async getStats(): Promise<AdminStats> {
      return request<AdminStats>('/api/admin/stats');
    },

    async resetInstituteData(): Promise<{ message: string }> {
    return request<{ message: string }>("/api/admin/reset-demo-data", {
      method: "POST",
    });
  },
  async resetDemoData(): Promise<{ message: string }> {
      return request<{ message: string }>('/api/reset-data', {
        method: 'POST',
      });
    },
  },

  // 9. System Infrastructure & Database Status
  system: {
    async getStatus(): Promise<{
      name: string;
      version: string;
      database: {
        provider: string;
        supabaseConfigured: boolean;
        supabaseUrl: string | null;
        persistence: string;
      };
      storage: {
        provider: string;
        bucket: string;
      };
      stats: {
        totalUsers: number;
        totalStudents: number;
        totalCourses: number;
        totalLessons: number;
        totalEnrollments: number;
        totalProgressRecords: number;
      };
    }> {
      return request('/api/system/status');
    },
  },
};
