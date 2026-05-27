import { create } from 'zustand';
import { supabase } from '@/lib/supabaseClient';
import { generateDeterministicCard, checkWin } from '@/lib/bingoCards';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface BingoRoom {
  id: string;
  entry_fee: number;
  max_players: number;
  status: 'waiting' | 'countdown' | 'active' | 'finished';
  drawn_numbers: number[];
  winner_tg_id?: number | string | null;
  winner_id?: string | null;
  active_game_count?: number; 
  generation_seed?: string; 
}

export interface GameSession {
  id: string;
  room_id: string;
  tg_id: number;
  grid: number[]; 
  daubed: number[];
  card_index?: number;
  status?: string; 
}

interface BingoState {
  screen: 'lobby' | 'select' | 'card-select' | 'game'; 
  rooms: BingoRoom[];
  loadingRooms: boolean;
  error: string | null;

  currentRoom: BingoRoom | null;
  mySession: GameSession | null;
  gameStatus: 'idle' | 'joining-lobby' | 'selecting' | 'active' | 'countdown' | 'finished' | 'waiting';
  drawnNumbers: number[];
  daubed: Set<number>;
  winResult: { won: boolean; line?: number[] } | null;
  winnerId: string | null;
  payout: number | null;
  
  channel: RealtimeChannel | null;
  cardsChannel: RealtimeChannel | null;

  joiningSessionId: string | null; 
  allCardGrids: Record<number, number[]>; 
  selectedCardId: number | null; 
  takenCardIds: Set<number>; 

  isRecovering: boolean; 

  fetchRooms: () => Promise<void>;
  joinStakeRoom: (tgId: number, entryFee: number, maxPlayers: number) => Promise<void>;
  generateAllCardsForRoom: (seed: string) => void;
  selectCardPreview: (cardId: number) => void;
  finalizeJoinWithCard: (tgId: number) => Promise<number | void>;
  subscribeToRoomEvents: (roomId: string) => void;
  claimBingo: (tgId: number) => Promise<number | void>;
  daubCell: (cellIndex: number) => Promise<void>; 
  leaveGame: () => void;
  clearError: () => void;
  recoverSession: (tgId: number) => Promise<void>; 
}

export const useBingoStore = create<BingoState>((set, get) => ({
  screen: 'lobby',
  rooms: [],
  loadingRooms: false,
  error: null,

  currentRoom: null,
  mySession: null,
  gameStatus: 'idle',
  drawnNumbers: [],
  daubed: new Set([12]), 
  winResult: null,
  winnerId: null,
  payout: null,
  
  channel: null,
  cardsChannel: null,

  joiningSessionId: null,
  allCardGrids: {},
  selectedCardId: null,
  takenCardIds: new Set(),

  isRecovering: true, 

  fetchRooms: async () => {
    set({ loadingRooms: true });
    try {
      const { data, error } = await supabase
        .from('bingo_rooms')
        .select('*') 
        .in('status', ['waiting', 'active'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      set({ rooms: data ?? [], loadingRooms: false });
    } catch (e: any) {
      set({ error: e.message, loadingRooms: false });
    }
  },

  joinStakeRoom: async (tgId: number, entryFee: number, maxPlayers: number) => {
    set({ loadingRooms: true, error: null });
    try {
      const { data, error } = await supabase.rpc('bingo_join_or_create_lobby', {
        p_tg_id: tgId,
        p_fee: entryFee,
        p_max_players: maxPlayers
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: roomData, error: roomErr } = await supabase
        .from('bingo_rooms')
        .select('*')
        .eq('id', data.room_id)
        .single();
        
      if (roomErr) throw roomErr;

      set({ 
        joiningSessionId: data.session_id, 
        currentRoom: roomData,
        selectedCardId: null, 
        takenCardIds: new Set(data.taken_ids || []), 
        screen: 'card-select',
        loadingRooms: false,
      });

      get().generateAllCardsForRoom(roomData.generation_seed || roomData.id);
      get().subscribeToRoomEvents(roomData.id);

    } catch (e: any) {
      set({ error: e.message, loadingRooms: false });
      throw e;
    }
  },

  generateAllCardsForRoom: (seed: string) => {
    const grids: Record<number, number[]> = {};
    for (let i = 1; i <= 100; i++) {
      grids[i] = generateDeterministicCard(seed, i);
    }
    set({ allCardGrids: grids });
  },

  selectCardPreview: (cardId: number) => {
    if (get().takenCardIds.has(cardId)) return;
    set({ selectedCardId: cardId });
  },

  finalizeJoinWithCard: async (tgId: number) => {
    const { joiningSessionId, currentRoom, selectedCardId, allCardGrids } = get();
    if (!joiningSessionId || !currentRoom || selectedCardId === null) return;

    const gridToUse = allCardGrids[selectedCardId];
    if (!gridToUse) return;

    set({ loadingRooms: true });

    try {
      const { data, error } = await supabase.rpc('bingo_finalize_join', {
        p_session_id: joiningSessionId,
        p_card_index: selectedCardId,
        p_card_grid: gridToUse
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      set({
        mySession: {
          id: joiningSessionId,
          room_id: currentRoom.id,
          tg_id: tgId,
          grid: gridToUse,
          daubed: [12],
          card_index: selectedCardId,
          status: 'ready'
        },
        screen: 'game',
        gameStatus: currentRoom.status,
        loadingRooms: false,
        joiningSessionId: null,
        winResult: null 
      });

    } catch (e: any) {
      set({ error: e.message, loadingRooms: false });
      throw e;
    }
  },

  subscribeToRoomEvents: (roomId: string) => {
    const { channel, cardsChannel } = get();
    if (channel) supabase.removeChannel(channel);
    if (cardsChannel) supabase.removeChannel(cardsChannel);

    const newChannel = supabase
      .channel(`bingo-room-${roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bingo_rooms', filter: `id=eq.${roomId}`}, 
        (payload) => {
          const { gameStatus } = get();

          // 🛡️ THE IMPENETRABLE LATCH:
          // If the game is locally finished, DROP the payload. Do not let Python drag us back to 'active'.
          if (gameStatus === 'finished') {
            return;
          }

          const room = payload.new as BingoRoom; 
          const drawn: number[] = room.drawn_numbers ?? [];
          const { mySession, daubed } = get();

          let currentWinResult = get().winResult;
          if (mySession && mySession.grid) {
            currentWinResult = checkWin(mySession.grid, daubed, new Set(drawn));
          }

          set({
            currentRoom: room,
            drawnNumbers: drawn,
            gameStatus: room.status,
            winnerId: room.winner_tg_id ? String(room.winner_tg_id) : room.winner_id,
            winResult: currentWinResult
          });
        }
      )
      .subscribe();

    const newCardsChannel = supabase
      .channel(`bingo-cards-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_cards', filter: `room_id=eq.${roomId}`}, 
        (payload: any) => {
          if (payload.new && payload.new.card_index) {
            set((state) => ({ takenCardIds: new Set(state.takenCardIds).add(payload.new.card_index) }));
          }
        }
      )
      .subscribe();

    set({ channel: newChannel, cardsChannel: newCardsChannel });
  },

  daubCell: async (cellIndex: number) => {
    const { mySession, drawnNumbers, currentRoom } = get();
    if (!mySession || !currentRoom) return;

    const num = mySession.grid[cellIndex];
    if (num !== 0 && !drawnNumbers.includes(num)) return;

    const newDaubed = new Set(get().daubed);
    newDaubed.add(cellIndex);

    const newWinResult = checkWin(mySession.grid, newDaubed, new Set(drawnNumbers));

    set({ daubed: newDaubed, winResult: newWinResult });

    try {
      await supabase.rpc('bingo_daub_cell', {
        p_session_id: mySession.id,
        p_daubed: Array.from(newDaubed)
      });
    } catch (error) {
      console.error("Failed to save daub to secure server:", error);
    }
  },

  claimBingo: async (tgId: number) => {
    const { mySession, currentRoom } = get();
    if (!mySession || !currentRoom) return;

    const idempotencyKey = `win-${mySession.id}`;
    try {
      const { data, error } = await supabase.rpc('bingo_claim_win', {
        p_session_id: mySession.id,
        p_room_id: currentRoom.id,
        p_tg_id: tgId,
        p_idem_key: idempotencyKey,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      set({ gameStatus: 'finished', payout: data.payout, winnerId: String(tgId) });
      return data.new_balance; 
    } catch (e: any) {
      set({ error: e.message });
      throw e;
    }
  },

  leaveGame: () => {
    const { channel, cardsChannel } = get();
    if (channel) supabase.removeChannel(channel);
    if (cardsChannel) supabase.removeChannel(cardsChannel);
    
    set({
      screen: 'lobby', currentRoom: null, mySession: null, drawnNumbers: [],
      daubed: new Set([12]), winResult: null, gameStatus: 'idle',
      winnerId: null, payout: null, channel: null, cardsChannel: null,
      joiningSessionId: null, allCardGrids: {}, selectedCardId: null, takenCardIds: new Set()
    });
  },

  clearError: () => set({ error: null }),

  recoverSession: async (tgId: number) => {
    try {
      const { data, error } = await supabase.rpc('bingo_recover_session', { p_tg_id: tgId });

      if (error) throw error;

      if (data && data.found) {
        const room = data.room as BingoRoom;
        const card = data.card as GameSession;

        if (room.status === 'finished') {
          set({ isRecovering: false, screen: 'lobby' });
          return;
        }

        get().generateAllCardsForRoom(room.generation_seed || room.id);
        get().subscribeToRoomEvents(room.id);

        if (card.status === 'joining') {
          const { data: takenData } = await supabase
            .from('bingo_cards')
            .select('card_index')
            .eq('room_id', room.id)
            .not('card_index', 'is', null);
            
          const taken = new Set((takenData || []).map(t => t.card_index));

          set({
            currentRoom: room,
            joiningSessionId: card.id,
            takenCardIds: taken,
            screen: 'card-select',
            isRecovering: false
          });

        } else if (card.status === 'ready') {
          const currentDaubed = new Set(card.daubed || [12]);
          const drawnList = room.drawn_numbers || [];
          const winResult = checkWin(card.grid, currentDaubed, new Set(drawnList));

          set({
            currentRoom: room,
            mySession: card,
            drawnNumbers: drawnList,
            daubed: currentDaubed,
            gameStatus: room.status,
            winResult: winResult,
            screen: 'game',
            isRecovering: false
          });
        }
      } else {
        set({ isRecovering: false, screen: 'lobby' });
      }
    } catch (e: any) {
      console.error("Failed to recover session:", e.message || JSON.stringify(e));
      set({ isRecovering: false, screen: 'lobby' });
    }
  },
}));