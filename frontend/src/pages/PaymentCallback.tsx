import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'failed'>('loading');
  const [message, setMessage] = useState('Verifying your payment...');

  useEffect(() => {
    const reference = searchParams.get('reference') || searchParams.get('trxref');
    const isCardAdd = searchParams.get('type') === 'card_add';
    
    if (!reference) {
      setStatus('failed');
      setMessage('No payment reference found in URL');
      setTimeout(() => navigate(isCardAdd ? '/payment-methods' : '/'), 3000);
      return;
    }

    api.get(`/payments/verify?reference=${reference}`)
      .then((res: any) => {
        if (res.success) {
          setStatus('success');
          const isCardVerification = isCardAdd || res.type === 'CARD_VERIFICATION';
          if (isCardVerification) {
            setMessage('Your card has been verified and securely saved for recurring renewals. The ₦100 verification charge has been refunded.');
            setTimeout(() => navigate('/payment-methods'), 2500);
          } else {
            setMessage(res.message || 'Payment successful!');
            setTimeout(() => navigate('/my-subscriptions'), 2000);
          }
        } else {
          setStatus('failed');
          setMessage(res.message || 'Payment verification failed');
          setTimeout(() => navigate(isCardAdd ? '/payment-methods' : '/'), 3000);
        }
      })
      .catch((err) => {
        setStatus('failed');
        setMessage(err.message || 'Something went wrong');
        setTimeout(() => navigate(isCardAdd ? '/payment-methods' : '/'), 3000);
      });
  }, [searchParams, navigate]);

  const isCardAdd = searchParams.get('type') === 'card_add';

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="dark-panel p-10 text-center border-[#26293b] max-w-md w-full">
        {status === 'loading' && (
          <>
            <Loader2 size={40} className="mx-auto text-indigo-400 animate-spin mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">{isCardAdd ? 'Verifying Card' : 'Verifying Payment'}</h2>
            <p className="text-xs text-slate-400">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 size={40} className="mx-auto text-emerald-400 mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">{isCardAdd ? 'Card Verified!' : 'Payment Successful!'}</h2>
            <p className="text-xs text-slate-400">{message}</p>
            <p className="text-xs text-slate-500 mt-2">
              {isCardAdd ? 'Redirecting to your payment methods...' : 'Redirecting to your subscriptions...'}
            </p>
          </>
        )}
        {status === 'failed' && (
          <>
            <XCircle size={40} className="mx-auto text-red-400 mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">{isCardAdd ? 'Card Verification Failed' : 'Payment Failed'}</h2>
            <p className="text-xs text-slate-400">{message}</p>
            <p className="text-xs text-slate-500 mt-2">Redirecting...</p>
          </>
        )}
      </div>
    </div>
  );
}