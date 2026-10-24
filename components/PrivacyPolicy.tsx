import React from 'react';
import { Shield, ArrowLeft } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface PrivacyPolicyProps {
  onBack: () => void;
}

export const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onBack }) => {
  const { language } = useLanguage();

  return (
    <div className="max-w-4xl mx-auto py-10 px-6">
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-slate-500 hover:text-brand-purple transition-colors mb-8 group"
      >
        <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
        <span>Back to Studio</span>
      </button>

      <div className="glass-card rounded-[40px] p-8 sm:p-12 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-brand-purple/5 blur-[100px] -z-10" />
        
        <div className="flex items-center gap-4 mb-10">
          <div className="w-16 h-16 bg-brand-purple/10 rounded-2xl flex items-center justify-center text-brand-purple">
            <Shield size={32} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white">
              {language === 'mm' ? 'ကိုယ်ရေးအချက်အလက် ထိန်းသိမ်းမှု မူဝါဒ' : 'Privacy Policy'}
            </h1>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mt-1">Vlogs By Saw • 2026 Edition</p>
          </div>
        </div>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-8 text-slate-600 dark:text-slate-300">
          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-3">
              <div className="w-2 h-8 bg-brand-purple rounded-full" />
              {language === 'mm' ? '၁။ အချက်အလက် စုဆောင်းခြင်း' : '1. Data Collection'}
            </h2>
            <p className="leading-relaxed">
              {language === 'mm' 
                ? 'ကျွန်ုပ်တို့သည် သင်၏ Gemini API Key ကို သင်၏ browser storage တွင်သာ သိမ်းဆည်းထားပြီး ကျွန်ုပ်တို့၏ server များသို့ မည်သည့်အခါမှ ပေးပို့ခြင်း မရှိပါ။ သင်၏ ဇာတ်လမ်းစာသားများကို အသံထုတ်ယူရန်အတွက်သာ အသုံးပြုပြီး မှတ်တမ်းတွင် သိမ်းဆည်းထားရန် သင်ကိုယ်တိုင် ရွေးချယ်မှသာ server တွင် သိမ်းဆည်းပါသည်။' 
                : 'We prioritize your privacy. Your Gemini API Key is stored only in your local browser storage and is never sent to our servers. Your narration scripts are processed only for voice generation and are only saved to our server if you explicitly choose to save them to your history.'}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-3">
              <div className="w-2 h-8 bg-brand-purple rounded-full" />
              {language === 'mm' ? '၂။ ပြင်ပဝန်ဆောင်မှုများ' : '2. Third-Party Services'}
            </h2>
            <p className="leading-relaxed">
              {language === 'mm'
                ? 'ဤဝန်ဆောင်မှုသည် Google Gemini AI API ကို အသုံးပြုပါသည်။ သင်၏ စာသားများသည် အသံထုတ်ယူရန်အတွက် Google ၏ server များသို့ ပေးပို့ခြင်း ခံရမည်ဖြစ်သည်။ ထို့အပြင် authentication နှင့် database အတွက် Google Firebase ကို အသုံးပြုထားပါသည်။'
                : 'This service utilizes Google Gemini AI API. Your scripts will be sent to Google servers for audio generation. Additionally, we use Google Firebase for authentication and database services.'}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-3">
              <div className="w-2 h-8 bg-brand-purple rounded-full" />
              {language === 'mm' ? '၃။ လုံခြုံရေး' : '3. Security'}
            </h2>
            <p className="leading-relaxed">
              {language === 'mm'
                ? 'ကျွန်ုပ်တို့သည် အဆင့်မြင့် encrypt လုပ်ထားသော cloud စနစ်ကို အသုံးပြု၍ သင်၏ အကောင့်နှင့် မှတ်တမ်းများကို လုံခြုံစွာ သိမ်းဆည်းထားပါသည်။ သင်၏ password များနှင့် API key များကို လုံခြုံစွာ ကိုင်တွယ်ပါသည်။'
                : 'We employ advanced encrypted cloud infrastructure to keep your account and history secure. Your passwords and API keys are handled with state-of-the-art security measures.'}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-3">
              <div className="w-2 h-8 bg-brand-purple rounded-full" />
              {language === 'mm' ? '၄။ ဆက်သွယ်ရန်' : '4. Contact'}
            </h2>
            <p className="leading-relaxed">
              {language === 'mm'
                ? 'ကိုယ်ရေးအချက်အလက်ဆိုင်ရာ မေးမြန်းလိုသည်များရှိပါက Vlogs By Saw admin ထံ တိုက်ရိုက်ဆက်သွယ် မေးမြန်းနိုင်ပါသည်။'
                : 'For any privacy-related inquiries, please contact Vlogs By Saw administration directly.'}
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-200 dark:border-white/5 text-center">
          <p className="text-xs text-slate-500 font-medium tracking-widest uppercase">
            © 2026 Vlogs By Saw • All Rights Reserved
          </p>
        </div>
      </div>
    </div>
  );
};
