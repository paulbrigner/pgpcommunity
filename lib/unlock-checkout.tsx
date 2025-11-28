'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrowserProvider, Contract, JsonRpcProvider, ZeroAddress, formatUnits } from 'ethers';
import { WalletService } from '@unlock-protocol/unlock-js';
import { networks } from '@unlock-protocol/networks';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Select } from '@/components/ui/select';

import {
  BASE_BLOCK_EXPLORER_URL,
  BASE_CHAIN_ID_HEX,
  BASE_NETWORK_ID,
  BASE_RPC_URL,
  MEMBERSHIP_RECURRING_PAYMENTS,
  UNLOCK_ADDRESS,
  UNLOCK_SUBGRAPH_URL,
} from '@/lib/config';
import { decodeUnlockError } from '@/lib/membership';
import {
  getEventCheckoutTarget,
  getMembershipCheckoutTarget,
  isEventTarget,
  isMembershipTarget,
  MEMBERSHIP_CHECKOUT_TARGETS,
  type CheckoutTarget,
} from '@/lib/checkout-config';

const LOCK_ABI = [
  'function keyPrice() view returns (uint256)',
  'function tokenAddress() view returns (address)',
  'function name() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function getHasValidKey(address _owner) view returns (bool)',
];

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

type CheckoutIntent =
  | { kind: 'membership'; tierId?: string | null }
  | { kind: 'renewal'; tierId: string }
  | { kind: 'event'; lockAddress: string };

type CheckoutStatus = 'idle' | 'loading' | 'ready' | 'processing' | 'success' | 'error';

type PricingInfo = {
  rawValue: bigint;
  decimals: number;
  symbol: string;
  erc20Address: string | null;
  displayPrice: string;
};

const toDisplayPrice = (raw: bigint, decimals: number, symbol: string) => {
  const formatted = formatUnits(raw, decimals);
  return `${formatted} ${symbol}`.trim();
};

const ensureBaseNetwork = async (provider: any) => {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID_HEX }] });
  } catch (error: any) {
    if (error?.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BASE_CHAIN_ID_HEX,
            chainName: 'Base',
            rpcUrls: [BASE_RPC_URL],
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            blockExplorerUrls: [BASE_BLOCK_EXPLORER_URL],
          },
        ],
      });
    } else {
      throw error;
    }
  }
};

const fetchPricing = async (target: CheckoutTarget): Promise<PricingInfo> => {
  const rpc = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
  const lock = new Contract(target.checksumAddress, LOCK_ABI, rpc);
  const [keyPrice, tokenAddress] = await Promise.all([
    lock.keyPrice(),
    lock.tokenAddress().catch(() => ZeroAddress),
  ]);

  if (tokenAddress && tokenAddress !== ZeroAddress) {
    const erc20 = new Contract(tokenAddress, ERC20_ABI, rpc);
    const [symbol, decimalsValue] = await Promise.all([
      erc20.symbol().catch(() => 'ERC20'),
      erc20.decimals().catch(() => 18),
    ]);
    const decimals = Number(decimalsValue) || 18;
    return {
      rawValue: BigInt(keyPrice),
      decimals,
      symbol,
      erc20Address: tokenAddress,
      displayPrice: toDisplayPrice(BigInt(keyPrice), decimals, symbol),
    };
  }

  return {
    rawValue: BigInt(keyPrice),
    decimals: 18,
    symbol: 'ETH',
    erc20Address: null,
    displayPrice: toDisplayPrice(BigInt(keyPrice), 18, 'ETH'),
  };
};

const ensureErc20Approval = async (
  provider: BrowserProvider,
  owner: string,
  lockAddress: string,
  erc20Address: string,
  allowanceTarget: bigint,
) => {
  const signer = await provider.getSigner();
  const erc20 = new Contract(erc20Address, ERC20_ABI, signer);
  const current: bigint = await erc20.allowance(owner, lockAddress);
  if (current >= allowanceTarget) {
    return;
  }
  const tx = await erc20.approve(lockAddress, allowanceTarget);
  await tx.wait();
};

const formatErrorMessage = (error: unknown) => {
  if (!error) return 'Unable to complete checkout. Please try again.';
  const message = typeof (error as any)?.message === 'string' ? (error as any).message : '';
  if (typeof (error as any)?.data === 'string') {
    return decodeUnlockError((error as any).data);
  }
  if (typeof (error as any)?.error?.data === 'string') {
    return decodeUnlockError((error as any).error.data);
  }
  if (message?.startsWith('0x')) {
    return decodeUnlockError(message);
  }
  return message || 'Unable to complete checkout. Please try again.';
};

const findExistingMembershipTokenId = async (lockAddress: string, owner: string, walletService?: WalletService): Promise<string | null> => {
  try {
    const rpc = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
    const lock = new Contract(lockAddress, LOCK_ABI, rpc);
    const balance: bigint = await lock.balanceOf(owner).catch(() => 0n);
    if (balance <= 0n) {
      return null;
    }
    const tokenId = await lock.tokenOfOwnerByIndex(owner, 0);
    if (tokenId == null) {
      return null;
    }
    const value = typeof tokenId === 'bigint' ? tokenId : BigInt(tokenId);
    return value >= 0n ? value.toString() : null;
  } catch (err) {
    console.warn('Failed to locate existing membership token id', err);
    if (walletService && typeof (walletService as any).getTokenIdForOwner === 'function') {
      try {
        const tokenId = await (walletService as any).getTokenIdForOwner(lockAddress, owner);
        if (tokenId != null) {
          const value = typeof tokenId === 'bigint' ? tokenId : BigInt(tokenId);
          return value >= 0n ? value.toString() : null;
        }
      } catch (err2) {
        console.warn('WalletService getTokenIdForOwner failed', err2);
      }
    }
    return null;
  }
};

const fetchAnyTokenId = async (lockAddress: string, owner: string): Promise<string | null> => {
  try {
    const rpc = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
    const lock = new Contract(lockAddress, LOCK_ABI, rpc);
    const balance: bigint = await lock.balanceOf(owner).catch(() => 0n);
    if (balance <= 0n) return null;
    const count = Number(balance);
    const cap = Number.isFinite(count) ? Math.min(count, 10) : 0;
    for (let i = 0; i < cap; i++) {
      try {
        const tokenId = await lock.tokenOfOwnerByIndex(owner, BigInt(i));
        if (tokenId != null) {
          const value = typeof tokenId === 'bigint' ? tokenId : BigInt(tokenId);
          if (value >= 0n) return value.toString();
        }
      } catch {}
    }
  } catch (err) {
    console.warn('fetchAnyTokenId failed', lockAddress, owner, err);
  }
  return null;
};

const hasAnyKey = async (lockAddress: string, owner: string): Promise<boolean> => {
  try {
    const rpc = new JsonRpcProvider(BASE_RPC_URL, BASE_NETWORK_ID);
    const lock = new Contract(lockAddress, LOCK_ABI, rpc);
    const hasValid: boolean = await lock.getHasValidKey(owner).catch(() => false);
    if (hasValid) return true;
    const balance: bigint = await lock.balanceOf(owner).catch(() => 0n);
    return balance > 0n;
  } catch (err) {
    console.warn('hasAnyKey check failed', lockAddress, owner, err);
    return false;
  }
};

const fetchTokenIdFromSubgraph = async (lockAddress: string, owner: string): Promise<string | null> => {
  if (!UNLOCK_SUBGRAPH_URL) return null;
  const endpoint = UNLOCK_SUBGRAPH_URL.trim();
  if (!endpoint) return null;
  const payload = {
    query: `
      query TokenIdForOwner($lock: String!, $owner: String!) {
        keys(where: { lock: $lock, owner: $owner }) {
          tokenId
        }
      }
    `,
    variables: {
      lock: lockAddress.toLowerCase(),
      owner: owner.toLowerCase(),
    },
  };
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const rows: any[] = body?.data?.keys ?? [];
    const first = rows.find((row) => row?.tokenId != null);
    if (!first?.tokenId) return null;
    try {
      const value = typeof first.tokenId === 'bigint' ? first.tokenId : BigInt(first.tokenId);
      return value >= 0n ? value.toString() : null;
    } catch {
      const raw = String(first.tokenId);
      return raw.length ? raw : null;
    }
  } catch (err) {
    console.warn('fetchTokenIdFromSubgraph failed', err);
    return null;
  }
};

export interface UnlockCheckoutHandlers {
  onMembershipComplete?: (target: CheckoutTarget) => void | Promise<void>;
  onEventComplete?: (target: CheckoutTarget) => void | Promise<void>;
  onClose?: () => void;
}

export const decideExtend = (params: {
  intentKind: CheckoutIntent['kind'];
  tokenIdForExtend: string | null;
  hasPrefetchedKey: boolean;
  hasKeyOnChain: boolean;
}) => {
  const { intentKind, tokenIdForExtend, hasPrefetchedKey, hasKeyOnChain } = params;
  const hasAnyKeyIndicator = hasPrefetchedKey || hasKeyOnChain;
  const shouldExtend =
    intentKind === 'renewal' ||
    !!tokenIdForExtend ||
    hasAnyKeyIndicator;
  return {
    shouldExtend,
    hasAnyKeyIndicator,
  };
};

export const useUnlockCheckout = (handlers: UnlockCheckoutHandlers = {}, prefetchedTokenIds?: Record<string, string[] | undefined>) => {
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  const [target, setTarget] = useState<CheckoutTarget | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const close = useCallback(() => {
    setIntent(null);
    setTarget(null);
    setPricing(null);
    setStatus('idle');
    setError(null);
    setTxHash(null);
    handlers.onClose?.();
  }, [handlers]);

  const openMembershipCheckout = useCallback(
    (tierId?: string | null) => {
      const membershipTarget = getMembershipCheckoutTarget(tierId);
      if (!membershipTarget) {
        setError('No membership tier is configured.');
        setStatus('error');
        return;
      }
      setIntent({ kind: 'membership', tierId: tierId ?? membershipTarget.id });
      setTarget(membershipTarget);
      setPricing(null);
      setStatus('loading');
      setError(null);
      setTxHash(null);
    },
    [],
  );

  const openRenewalCheckout = useCallback((tierId: string) => {
    const membershipTarget = getMembershipCheckoutTarget(tierId);
    if (!membershipTarget) {
      setError('Unable to locate that membership tier.');
      setStatus('error');
      return;
    }
    setIntent({ kind: 'renewal', tierId: membershipTarget.id });
    setTarget(membershipTarget);
    setPricing(null);
    setStatus('loading');
    setError(null);
    setTxHash(null);
  }, []);

  const openEventCheckout = useCallback((lockAddress: string) => {
    const eventTarget = getEventCheckoutTarget(lockAddress);
    if (!eventTarget) {
      setError('Event checkout is not available for this lock.');
      setStatus('error');
      return;
    }
    setIntent({ kind: 'event', lockAddress: eventTarget.checksumAddress });
    setTarget(eventTarget);
    setPricing(null);
    setStatus('loading');
    setError(null);
    setTxHash(null);
  }, []);

  const selectMembershipTier = useCallback((tierId: string) => {
    const next = getMembershipCheckoutTarget(tierId);
    if (!next) return;
    setTarget(next);
    setIntent((current) => {
      if (!current) return current;
      if (current.kind === 'membership') {
        return { kind: 'membership', tierId: next.id };
      }
      if (current.kind === 'renewal') {
        return { kind: 'renewal', tierId: next.id };
      }
      return current;
    });
    setPricing(null);
    setStatus('loading');
    setError(null);
    setTxHash(null);
  }, []);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setStatus((current) => (current === 'idle' ? 'loading' : current));
    (async () => {
      try {
        const details = await fetchPricing(target);
        if (!cancelled) {
          setPricing(details);
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(formatErrorMessage(err));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const confirm = useCallback(async () => {
    if (!intent || !target || !pricing) return;
    setStatus('processing');
    setError(null);
    setTxHash(null);
    try {
      const provider = (window as any)?.ethereum;
      if (!provider) {
        throw new Error('No wallet provider detected.');
      }
      await ensureBaseNetwork(provider);
      const browserProvider = new BrowserProvider(provider, BASE_NETWORK_ID);
      const walletService = new WalletService({
        ...networks,
        [BASE_NETWORK_ID]: {
          ...networks[BASE_NETWORK_ID],
          provider: BASE_RPC_URL,
          unlockAddress: UNLOCK_ADDRESS,
        },
      } as any);
      const signer = await browserProvider.getSigner();
      await walletService.connect(browserProvider as unknown as JsonRpcProvider, signer);
      const owner = await signer.getAddress();

      const overrides = target.overrides;
      const overrideReferrer = overrides && typeof overrides.referrer === 'string' && overrides.referrer.trim().length
        ? overrides.referrer.trim()
        : undefined;
      const overrideProtocolReferrer = overrides && typeof overrides.protocolReferrer === 'string' && overrides.protocolReferrer.trim().length
        ? overrides.protocolReferrer.trim()
        : undefined;
      const overrideKeyManager = overrides && typeof overrides.keyManager === 'string' && overrides.keyManager.trim().length
        ? overrides.keyManager.trim()
        : undefined;
      const overrideData = overrides && typeof overrides.data === 'string' && overrides.data.length ? overrides.data : undefined;
      const overrideAdditionalPeriods = overrides && typeof overrides.additionalPeriods === 'number' && Number.isFinite(overrides.additionalPeriods)
        ? overrides.additionalPeriods
        : undefined;
      const rawRecurring = overrides?.recurringPayments;
      const recurringPaymentsPreference =
        rawRecurring === 'forever'
          ? 'forever'
          : typeof rawRecurring === 'number' && Number.isFinite(rawRecurring) && rawRecurring > 0
            ? rawRecurring
            : intent.kind === 'membership' || intent.kind === 'renewal'
              ? MEMBERSHIP_RECURRING_PAYMENTS
              : undefined;
      const recurringPayments = typeof recurringPaymentsPreference === 'number' ? recurringPaymentsPreference : undefined;
      const rawTotalApproval = overrides?.totalApproval;
      let explicitApproval: bigint | null = null;
      if (typeof rawTotalApproval === 'bigint') {
        explicitApproval = rawTotalApproval > 0n ? rawTotalApproval : null;
      } else if (typeof rawTotalApproval === 'number' && Number.isFinite(rawTotalApproval) && rawTotalApproval > 0) {
        explicitApproval = BigInt(Math.floor(rawTotalApproval));
      } else if (typeof rawTotalApproval === 'string' && rawTotalApproval.trim().length) {
        try {
          const parsed = BigInt(rawTotalApproval.trim());
          explicitApproval = parsed > 0n ? parsed : null;
        } catch {}
      }

      const prefetchedTokenIdList = prefetchedTokenIds?.[target.checksumAddress.toLowerCase()] || prefetchedTokenIds?.[target.lockAddress?.toLowerCase?.() ?? ''];
      const prefetchedTokenId = Array.isArray(prefetchedTokenIdList) && prefetchedTokenIdList.length ? prefetchedTokenIdList[0] : null;
      const hasPrefetchedKey = Array.isArray(prefetchedTokenIdList) && prefetchedTokenIdList.length > 0;
      const existingTokenId = isMembershipTarget(target)
        ? (prefetchedTokenId ?? await findExistingMembershipTokenId(target.checksumAddress, owner, walletService))
        : null;
      // Preflight: if we still don't have a token id, do a quick on-chain enumeration to avoid triggering a purchase on a max-keys lock
      const fallbackTokenId = !existingTokenId && isMembershipTarget(target)
        ? await fetchAnyTokenId(target.checksumAddress, owner)
        : null;
      let tokenIdForExtend = prefetchedTokenId ?? existingTokenId ?? fallbackTokenId;
      const hasKeyOnChain = isMembershipTarget(target) ? await hasAnyKey(target.checksumAddress, owner) : false;
      const { shouldExtend, hasAnyKeyIndicator: hasKey } = decideExtend({
        intentKind: intent.kind,
        tokenIdForExtend,
        hasPrefetchedKey,
        hasKeyOnChain,
      });

      if (pricing.erc20Address && pricing.erc20Address !== ZeroAddress) {
        let approvalTarget: bigint | null = null;
        if (explicitApproval) {
          approvalTarget = explicitApproval;
        } else if (typeof recurringPayments === 'number' && recurringPayments > 1) {
          approvalTarget = pricing.rawValue * BigInt(recurringPayments);
        } else if (intent.kind === 'membership' || intent.kind === 'renewal') {
          approvalTarget = pricing.rawValue * BigInt(MEMBERSHIP_RECURRING_PAYMENTS);
        } else {
          approvalTarget = pricing.rawValue;
        }

        if (approvalTarget && approvalTarget > 0n && recurringPaymentsPreference !== 'forever') {
          await ensureErc20Approval(
            browserProvider,
            owner,
            target.checksumAddress,
            pricing.erc20Address,
            approvalTarget,
          );
        }
      }

      let hash: string | null = null;
      if (shouldExtend) {
        if (!tokenIdForExtend && hasKey) {
          setError('We detected an existing key for this tier but could not locate its token id to renew. Please try again from Profile or contact support.');
          setStatus('error');
          return;
        }
        const tx = await walletService.extendKey({
          lockAddress: target.checksumAddress,
          owner,
          tokenId: tokenIdForExtend ?? undefined,
          keyPrice: formatUnits(pricing.rawValue, pricing.decimals),
          erc20Address: pricing.erc20Address ?? undefined,
          decimals: pricing.decimals,
          referrer: overrideReferrer ?? owner,
          data: overrideData,
          recurringPayments,
          totalApproval: explicitApproval ? explicitApproval.toString() : undefined,
        } as any);
        hash = typeof tx === 'string' ? tx : tx?.hash ?? null;
        if (handlers.onMembershipComplete) {
          await handlers.onMembershipComplete(target);
        }
      } else {
        if (isMembershipTarget(target)) {
          // Final safeguard: before purchasing, check subgraph once more to avoid max-keys reverts.
          const subgraphTokenId = await fetchTokenIdFromSubgraph(target.checksumAddress, owner);
          if (subgraphTokenId) {
            tokenIdForExtend = subgraphTokenId;
            const tx = await walletService.extendKey({
              lockAddress: target.checksumAddress,
              owner,
              tokenId: tokenIdForExtend,
              keyPrice: formatUnits(pricing.rawValue, pricing.decimals),
              erc20Address: pricing.erc20Address ?? undefined,
              decimals: pricing.decimals,
              referrer: overrideReferrer ?? owner,
              data: overrideData,
              recurringPayments,
              totalApproval: explicitApproval ? explicitApproval.toString() : undefined,
            } as any);
            hash = typeof tx === 'string' ? tx : tx?.hash ?? null;
            await handlers.onMembershipComplete?.(target);
            setTxHash(hash);
            setStatus('success');
            return;
          }

          const keyExists = hasKey || await hasAnyKey(target.checksumAddress, owner);
          if (keyExists) {
            if (!tokenIdForExtend) {
              setError('You already hold a key for this tier. We could not determine the token id to renew; please try again from Profile or contact support.');
              setStatus('error');
              return;
            }
            const tx = await walletService.extendKey({
              lockAddress: target.checksumAddress,
              owner,
              tokenId: tokenIdForExtend,
              keyPrice: formatUnits(pricing.rawValue, pricing.decimals),
              erc20Address: pricing.erc20Address ?? undefined,
              decimals: pricing.decimals,
              referrer: overrideReferrer ?? owner,
              data: overrideData,
              recurringPayments,
              totalApproval: explicitApproval ? explicitApproval.toString() : undefined,
            } as any);
            hash = typeof tx === 'string' ? tx : tx?.hash ?? null;
            await handlers.onMembershipComplete?.(target);
            setTxHash(hash);
            setStatus('success');
            return;
          }
        }

        const tx = await walletService.purchaseKey({
          lockAddress: target.checksumAddress,
          owner,
          keyPrice: formatUnits(pricing.rawValue, pricing.decimals),
          erc20Address: pricing.erc20Address ?? undefined,
          decimals: pricing.decimals,
          referrer: overrideReferrer,
          protocolReferrer: overrideProtocolReferrer,
          keyManager: overrideKeyManager,
          data: overrideData,
          additionalPeriods: overrideAdditionalPeriods,
          recurringPayments: recurringPayments,
          totalApproval: explicitApproval ? explicitApproval.toString() : undefined,
        } as any);
        hash = typeof tx === 'string' ? tx : tx?.hash ?? null;
        if (isEventTarget(target)) {
          await handlers.onEventComplete?.(target);
        } else {
          await handlers.onMembershipComplete?.(target);
        }
      }

      setTxHash(hash);
      setStatus('success');
    } catch (err) {
      console.error('Checkout failed:', err);
      setError(formatErrorMessage(err));
      setStatus('error');
    }
  }, [handlers, intent, prefetchedTokenIds, pricing, target]);

  const drawer = useMemo(() => {
    if (!isClient || !target || !intent) return null;
    const membershipOptions = MEMBERSHIP_CHECKOUT_TARGETS.map((tier) => ({
      label: tier.label || tier.checksumAddress.slice(0, 6).concat('…').concat(tier.checksumAddress.slice(-4)),
      value: tier.id,
    }));
    const allowTierSwitch = intent.kind === 'membership' && MEMBERSHIP_CHECKOUT_TARGETS.length > 1 && status !== 'success';
    return createPortal(
      <Drawer isOpen onOpenChange={(open: boolean) => (open ? undefined : close())} title="Unlock Checkout">
        <div className="flex flex-col gap-6 p-6">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--brand-navy)]">
              {isMembershipTarget(target)
                ? target.label || 'PGP Membership'
                : 'Event Registration'}
            </p>
            {status !== 'success' && (
              <p className="text-xs text-[var(--muted-ink)]">
                Base · Lock {target.checksumAddress.slice(0, 6)}…{target.checksumAddress.slice(-4)}
              </p>
            )}
          </div>

          {allowTierSwitch && (
            <Select
              key={target.id}
              label="Choose a membership tier"
              options={membershipOptions}
              defaultValue={target.id}
              onChange={(value) => selectMembershipTier(String(value))}
            />
          )}

          {pricing ? (
            <div className="rounded-lg bg-[rgba(67,119,243,0.08)] p-4 text-sm text-[var(--brand-navy)]">
              <p className="font-medium">Price</p>
              <p>{pricing.displayPrice}</p>
              {intent.kind === 'renewal' && (
                <p className="mt-2 text-xs text-[var(--muted-ink)]">
                  We will renew the selected membership tier using your connected wallet.
                </p>
              )}
              {intent.kind === 'membership' && (
                <p className="mt-2 text-xs text-[var(--muted-ink)]">
                  Complete checkout to activate your PGP membership instantly.
                </p>
              )}
              {intent.kind === 'event' && (
                <p className="mt-2 text-xs text-[var(--muted-ink)]">
                  Use your connected wallet to reserve a spot for this event.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-[rgba(67,119,243,0.05)] p-4 text-sm text-[var(--muted-ink)]">
              Fetching pricing details…
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
          )}

          {status === 'success' && (
            <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-700">
              {intent.kind === 'event'
                ? 'Registration completed. You can close this window when you are ready.'
                : 'Membership checkout completed successfully.'}
            </div>
          )}

          {txHash && (
            <a
              href={`${BASE_BLOCK_EXPLORER_URL}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[rgba(67,119,243,0.25)] bg-[rgba(67,119,243,0.05)] p-3 text-xs text-[var(--brand-denim)] hover:bg-[rgba(67,119,243,0.1)]"
            >
              View transaction on BaseScan
            </a>
          )}

          {status === 'success' ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button className="flex-1" onClick={close}>
                Close Checkout
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                variant="outlined-primary"
                onClick={close}
                className="flex-1"
                disabled={status === 'processing'}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={confirm}
                isLoading={status === 'processing'}
                disabled={!pricing || status === 'processing'}
              >
                {intent.kind === 'renewal' ? 'Renew Membership' : 'Confirm Checkout'}
              </Button>
            </div>
          )}
        </div>
      </Drawer>,
      document.body,
    );
  }, [close, confirm, error, intent, isClient, pricing, selectMembershipTier, status, target, txHash]);

  return {
    openMembershipCheckout,
    openRenewalCheckout,
    openEventCheckout,
    close,
    status,
    error,
    checkoutPortal: drawer,
  } as const;
};
