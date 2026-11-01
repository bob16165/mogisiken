import React from 'react';
import ReactDOM from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import PastQuestionPrototype from './PastQuestionPrototype';

const supabaseUrl = localStorage.getItem('mogisiken_supabase_url');
const supabaseAnonKey = localStorage.getItem('mogisiken_supabase_anon_key');
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : undefined;
const qualificationVariant = window.location.pathname.endsWith('/acupuncture-past-questions.html')
  ? 'acupuncture'
  : 'judo';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PastQuestionPrototype productionMode supabase={supabase} qualificationVariant={qualificationVariant} />
  </React.StrictMode>,
);
