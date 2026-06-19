export type RecipeStatus = 'Draft' | 'Ready' | 'Edited' | 'Posted' | 'Uploaded' | 'Done'
export type UserRole = 'admin' | 'editor' | 'viewer'

export interface Recipe {
  id: string
  sl_no: number
  recipe_name: string
  date: string
  editor: string
  categories: string[]
  tags: string[]
  instagram_format: string
  youtube_format: string
  fb_editor: string
  docs: string
  thumbnails: string
  website_draft: string
  recipe_copy: string
  status: RecipeStatus
  platforms: string[]
  created: string
  updated: string
}

export interface Category {
  id: string
  name: string
  group: string
  created: string
}

export interface Tag {
  id: string
  name: string
  color: string
  created: string
}

export interface TeamMember {
  id: string
  email: string
  name: string
  role: UserRole
  created: string
}

export interface AppUser {
  id: string
  email: string
  name: string
  role: UserRole
}

export type ReviewReason = 'no_match' | 'multiple_matches' | 'error' | 'duplicate'
export type ReviewStatus = 'pending' | 'resolved' | 'dismissed'

export interface ReviewCandidate {
  id: string
  sl_no: number
  recipe_name: string
  has_text?: boolean
}

export interface ReviewItem {
  id: string
  file_name: string
  raw_text: string
  reason: ReviewReason
  duplicate: boolean
  candidates: ReviewCandidate[]
  note: string
  status: ReviewStatus
  resolved_recipe: string
  created: string
  updated: string
}
