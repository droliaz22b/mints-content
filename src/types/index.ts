export type RecipeStatus = 'Draft' | 'Ready' | 'Edited' | 'Posted' | 'Uploaded' | 'Done'
export type UserRole = 'admin' | 'editor' | 'viewer'

export interface Recipe {
  id: string
  sl_no: number
  recipe_name: string
  date: string
  editor: string
  category: string
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
