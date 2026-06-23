import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gnqghqgfzcbosdsnlvnj.supabase.co'
const supabaseAnonKey = 'sb_publishable_XzCulHhYqHefGD6s46zwow_ciXm6WWm'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)