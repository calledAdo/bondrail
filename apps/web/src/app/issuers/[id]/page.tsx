import { notFound } from 'next/navigation';
import { findMarket } from '@/lib/data';
import { Details } from '@/components/details';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;const m=findMarket(id);if(!m)notFound();return <Details market={m} issuer/>}
