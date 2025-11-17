import React, { useMemo, useState, useCallback } from "react"; // 🚨 Added useCallback
import { View, Text, FlatList, TouchableOpacity, Alert, useColorScheme, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useUser } from "@clerk/clerk-expo";
import { useSupabase } from "@/lib/supabase";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import DownloadImage from "@/components/download/downloadImage";
import { getOrCreateConversation } from "@/services/conversationService";
import { 
    deleteRequest, 
    fetchAllRequests, 
    updateRequest, 
    fetchRequestsByUser,
    fetchAllVerificationMessages 
} from "@/services/requestService";
import { useRouter } from "expo-router";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";

// Define the type for the verification notification for easier merging
type VerificationNotification = {
    id: string; 
    type: 'verification' | 'pending_verification' | 'verification_success';
    title: string;
    reject_msg: string | null;
    created_at: string | null | undefined; 
    time: string;
    avatar: string; 
};

// Define a unified type for all notifications
type NotificationItem = any | VerificationNotification;


export default function NotificationIndex() {
    const router = useRouter();
    const { user } = useUser();
    const supabase = useSupabase();
    const queryClient = useQueryClient();
    const colorScheme = useColorScheme();
    const isDark = colorScheme === "dark";

    const [confirmVisible, setConfirmVisible] = useState(false);
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

    const defaultAvatar = "https://i.pravatar.cc/150";
    const avatarUrl = !user?.imageUrl || user.imageUrl.includes("clerk.dev/static") ? defaultAvatar : user.imageUrl;


    // ------------------ 1. Fetch User's Account Type and Dates ------------------
    const { data: userData, isLoading: isUserLoading, refetch: refetchUserData, isRefetching: isRefetchingUserData } = useQuery({ // 🚨 Added refetch and isRefetching
        queryKey: ["currentUser", user?.id],
        queryFn: async () => {
            if (!user?.id) return null;
            const { data, error } = await supabase
                .from("users")
                .select("account_type, created_at, verified_at") 
                .eq("id", user.id)
                .single();
            
            if (error && error.code !== "PGRST116") throw error;
            return data;
        },
        enabled: !!user?.id,
    });

    // ------------------ 2. Fetch Verification Messages (Rejected History) ------------------
    const { data: verificationMessages = [], refetch: refetchVerificationMessages, isRefetching: isRefetchingVerificationMessages } = useQuery({ // 🚨 Added refetch and isRefetching
        queryKey: ["verificationMessages", user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            return fetchAllVerificationMessages(user.id, supabase);
        },
        enabled: !!user?.id,
    });

    // ------------------ Existing Request Fetches ------------------
    const { data: myPosts = [], refetch: refetchMyPosts, isRefetching: isRefetchingMyPosts } = useQuery({ // 🚨 Added refetch and isRefetching
        queryKey: ["myPosts", user?.id],
        queryFn: async () => {
            if (!user) return [];
            const { data, error } = await supabase.from("posts").select("*").eq("user_id", user.id);
            if (error) throw error;
            return data ?? [];
        },
        enabled: !!user,
    });

    const postIds = useMemo(() => myPosts.map((p) => p.id), [myPosts]);

    // Requests to my posts
    const { data: postOwnerRequests = [], refetch: refetchPostOwnerRequests, isRefetching: isRefetchingPostOwnerRequests } = useQuery({ // 🚨 Added refetch and isRefetching
        queryKey: ["requestsToMyPosts", postIds],
        queryFn: async () => (postIds.length ? fetchAllRequests(postIds, supabase) : []),
        enabled: !!postIds.length,
    });

    // Requests I sent
    const { data: myRequests = [], refetch: refetchMyRequests, isRefetching: isRefetchingMyRequests } = useQuery({ // 🚨 Added refetch and isRefetching
        queryKey: ["myRequests", user?.id],
        queryFn: async () => (user ? fetchRequestsByUser(user.id, supabase) : []),
        enabled: !!user,
    });
    
    // ------------------ PULL-TO-REFRESH LOGIC ------------------

    // Determine if any query is currently refetching
    const isAnyRefetching = isRefetchingUserData || isRefetchingVerificationMessages || isRefetchingMyPosts || isRefetchingPostOwnerRequests || isRefetchingMyRequests;

    // Function to trigger refetching for all queries
    const handleRefresh = useCallback(async () => {
        // Use Promise.all to wait for all refetches to complete concurrently
        await Promise.all([
            refetchUserData(),
            refetchVerificationMessages(),
            refetchMyPosts(),
            refetchPostOwnerRequests(),
            refetchMyRequests(),
        ]);
    }, [refetchUserData, refetchVerificationMessages, refetchMyPosts, refetchPostOwnerRequests, refetchMyRequests]);

    // ------------------ 3. Combine ALL notifications ------------------
    const notifications: NotificationItem[] = useMemo(() => {
        let combined: NotificationItem[] = [...postOwnerRequests, ...myRequests];
        
        const accountType = userData?.account_type;

        // 🟢 Landlord Verified (Success) Notification
        if (accountType === 'landlord' && userData?.verified_at) { // Only show success if verified_at exists
            const verifiedDate = new Date(userData.verified_at);

            const successNotif: VerificationNotification = {
                id: `verification-success-${userData.verified_at}`,
                type: 'verification_success',
                title: "Account Verification Successful! 🎉",
                reject_msg: "The administrator has reviewed and approved your landlord account.",
                created_at: userData.verified_at, 
                time: formatDistanceToNow(verifiedDate, { addSuffix: true }), 
                avatar: "system",
            };
            combined.push(successNotif);
        }
        
        // 🟠 Landlord Unverified (Pending) Notification
        if (accountType === 'landlord_unverified') {
            const createdDate = userData?.created_at 
                ? new Date(userData.created_at) 
                : new Date(); 

            const pendingNotif: VerificationNotification = {
                id: `pending-verification-${userData?.created_at}`,
                type: 'pending_verification',
                title: "Verification Pending",
                reject_msg: "Your landlord proof is currently under administrator review.",
                created_at: userData?.created_at,
                time: formatDistanceToNow(createdDate, { addSuffix: true }),
                avatar: "system",
            };
            combined.push(pendingNotif);
        }

        // 🔴 Rejected Verification Notifications (History)
        verificationMessages.forEach((msg, index) => {
            const rejectionNotif: VerificationNotification = {
                id: `verification-reject-${msg.created_at}-${index}`, 
                type: 'verification',
                title: "Admin Notification: Account Verification Update", 
                reject_msg: msg.reject_msg,
                created_at: msg.created_at,
                time: msg.time,
                avatar: "system", 
            };
            combined.push(rejectionNotif);
        });


        // 🚨 FINAL SORT: Sort all notifications by created_at (newest first)
        return combined.sort((a, b) => {
            const dateA = (a.created_at !== null && a.created_at !== undefined) 
                          ? new Date(a.created_at).getTime() 
                          : ((a as any).post?.created_at ? new Date((a as any).post.created_at).getTime() : 0);
            const dateB = (b.created_at !== null && b.created_at !== undefined) 
                          ? new Date(b.created_at).getTime() 
                          : ((b as any).post?.created_at ? new Date((b as any).post.created_at).getTime() : 0); 
            
            return dateB - dateA;
        });

    }, [postOwnerRequests, myRequests, verificationMessages, userData]);


    // ------------------ Mutations (omitted for brevity) ------------------
    const { mutate: startChat } = useMutation({
        mutationFn: (selectedUser: any) => getOrCreateConversation(supabase, user!.id, selectedUser.id),
        onSuccess: (conversation, selectedUser: any) => {
            router.push(`/(channel)/${conversation.id}?name=${selectedUser.firstname}&avatar=${selectedUser.avatar ?? ""}`);
        },
        onError: () => Alert.alert("Error", "Failed to start chat."),
    });

    const deleteNotifMutation = useMutation({
        mutationFn: async () => {
            if (!selectedRequestId) throw new Error("No request selected");
            return deleteRequest(selectedRequestId, supabase);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["requestsToMyPosts"] });
            queryClient.invalidateQueries({ queryKey: ["myRequests"] });
            setConfirmVisible(false);
            setSelectedRequestId(null);
        },
    });

    const approveRequestMutation = useMutation({
        mutationFn: async (requestId: string) => updateRequest(requestId, supabase),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["requestsToMyPosts"] });
            queryClient.invalidateQueries({ queryKey: ["myRequests"] });
        },
    });

    const handleApprove = (id: string) => approveRequestMutation.mutate(id);
    const handleDelete = (id: string) => { setSelectedRequestId(id); setConfirmVisible(true); };
    const confirmDelete = () => deleteNotifMutation.mutate();
    const handleOpenPost = (id: string) => router.push(`/(post)/${id}`);


    if (isUserLoading) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#121212" : "#f5f5f5" }}>
                <ActivityIndicator size="large" color="#2563eb" />
            </View>
        );
    }


    // ------------------ 4. Render Notification ------------------
    const renderNotification = ({ item }: { item: NotificationItem }) => {
        
        // 🟢 Handle Success Verification Notification (Green)
        if (item.type === 'verification_success') {
            const vItem = item as VerificationNotification;
            return (
                <View 
                    key={vItem.id}
                    style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        padding: 12,
                        marginHorizontal: 12,
                        marginVertical: 6,
                        borderRadius: 12,
                        backgroundColor: isDark ? "#1e3b2e" : "#e6fbf2", // Green background for success
                        borderLeftWidth: 4,
                        borderLeftColor: isDark ? "#4caf50" : "#4caf50",
                        elevation: 2,
                    }}
                >
                    <Ionicons 
                        name="checkmark-circle" 
                        size={24} 
                        color={isDark ? "#4caf50" : "#4caf50"} 
                        style={{ marginRight: 12 }} 
                    />
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", fontSize: 14, color: isDark ? "#fff" : "#000" }}>
                            {vItem.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: isDark ? "#aaa" : "#555", marginTop: 2 }}>
                            {vItem.reject_msg} 
                        </Text>
                        <Text style={{ fontSize: 10, color: isDark ? "#777" : "#888", marginTop: 4 }}>
                            Verified {vItem.time}
                        </Text>
                    </View>
                </View>
            );
        }
        
        // 🟠 Handle Pending Verification Notification (Orange/Yellow)
        if (item.type === 'pending_verification') {
            const vItem = item as VerificationNotification;
            return (
                <View 
                    key={vItem.id}
                    style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        padding: 12,
                        marginHorizontal: 12,
                        marginVertical: 6,
                        borderRadius: 12,
                        backgroundColor: isDark ? "#3b3b1e" : "#fbf2e6", 
                        borderLeftWidth: 4,
                        borderLeftColor: isDark ? "#ff9800" : "#ff9800",
                        elevation: 2,
                    }}
                >
                    <Ionicons 
                        name="time" 
                        size={24} 
                        color={isDark ? "#ff9800" : "#ff9800"} 
                        style={{ marginRight: 12 }} 
                    />
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", fontSize: 14, color: isDark ? "#fff" : "#000" }}>
                            {vItem.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: isDark ? "#aaa" : "#555", marginTop: 2 }}>
                            {vItem.reject_msg} 
                        </Text>
                        <Text style={{ fontSize: 10, color: isDark ? "#777" : "#888", marginTop: 4 }}>
                            Submitted {vItem.time}
                        </Text>
                    </View>
                </View>
            );
        }
        
        // 🔵 HANDLE REJECTED VERIFICATION NOTIFICATION (Blue/Gray)
        if (item.type === 'verification') {
            const vItem = item as VerificationNotification;
            return (
                <View 
                    key={vItem.id}
                    style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        padding: 12,
                        marginHorizontal: 12,
                        marginVertical: 6,
                        borderRadius: 12,
                        backgroundColor: isDark ? "#292e44" : "#e6eaf8", 
                        borderLeftWidth: 4,
                        borderLeftColor: isDark ? "#667EEA" : "#667EEA",
                        elevation: 2,
                    }}
                >
                    <Ionicons 
                        name="information-circle" 
                        size={24} 
                        color={isDark ? "#667EEA" : "#667EEA"} 
                        style={{ marginRight: 12 }} 
                    />
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", fontSize: 14, color: isDark ? "#fff" : "#000" }}>
                            {vItem.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: isDark ? "#aaa" : "#555", marginTop: 2 }}>
                            {vItem.reject_msg || "No specific reason provided. Please update your profile proofs."}
                        </Text>
                        <Text style={{ fontSize: 10, color: isDark ? "#777" : "#888", marginTop: 4 }}>
                            Received {vItem.time}
                        </Text>
                    </View>
                </View>
            );
        }
        
        // 📝 EXISTING REQUEST NOTIFICATION LOGIC
        const isPostOwner = item.post.user_id === user?.id;
        const isRequestOwner = item.user.id === user?.id;

        return (
            <TouchableOpacity 
                key={item.id}
                onPress={() => handleOpenPost(item.postId)} 
                activeOpacity={0.8}
            >
                <View style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    padding: 12,
                    marginHorizontal: 12,
                    marginVertical: 6,
                    borderRadius: 12,
                    backgroundColor: isDark ? "#1f1f1f" : "#fff",
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 4,
                    elevation: 2,
                }}>
                    <DownloadImage
                        path={item.avatar}
                        supabase={supabase}
                        fallbackUri={avatarUrl}
                        style={{ width: 48, height: 48, borderRadius: 24, marginRight: 12 }}
                    />

                    <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "600", fontSize: 14, color: isDark ? "#fff" : "#000" }}>
                            {item.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: isDark ? "#aaa" : "#555", marginTop: 2 }}>
                            {item.time}
                        </Text>

                        {/* Status badge */}
                        {(isRequestOwner || isPostOwner) && (item.requested || item.confirmed) && (
                            <View style={{ flexDirection: "row", marginTop: 4, gap: 8 }}>
                                <View style={{
                                    backgroundColor: item.confirmed ? "#4caf50" : "#ff9800",
                                    alignSelf: "flex-start",
                                    paddingHorizontal: 8,
                                    paddingVertical: 2,
                                    borderRadius: 12,
                                }}>
                                    <Text style={{ color: "#fff", fontSize: 10, fontWeight: "500" }}>
                                        {item.confirmed ? "Approved" : "Acknowledged"}
                                    </Text>
                                </View>
                            </View>
                        )}

                        {/* Action buttons (only for post owner) */}
                        {isPostOwner && (
                            <View style={{ flexDirection: "row", marginTop: 6, gap: 8 }}>
                                {!item.requested && (
                                    <TouchableOpacity onPress={() => handleApprove(item.id)} style={{
                                        backgroundColor: "#ff9800",
                                        paddingHorizontal: 12,
                                        paddingVertical: 6,
                                        borderRadius: 8,
                                    }}>
                                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "500" }}>Acknowledge</Text>
                                    </TouchableOpacity>
                                )}
                                {item.requested && !item.confirmed && (
                                    <TouchableOpacity onPress={() => handleApprove(item.id)} style={{
                                        backgroundColor: "#667EEA",
                                        paddingHorizontal: 12,
                                        paddingVertical: 6,
                                        borderRadius: 8,
                                    }}>
                                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "500" }}>Approve</Text>
                                    </TouchableOpacity>
                                )}
                                {item.confirmed && (
                                    <View style={{
                                        backgroundColor: "#4caf50",
                                        paddingHorizontal: 12,
                                        paddingVertical: 6,
                                        borderRadius: 8,
                                    }}>
                                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "500" }}>Approved</Text>
                                    </View>
                                )}

                                <TouchableOpacity onPress={() => handleDelete(item.id)} style={{
                                    backgroundColor: "#e53935",
                                    paddingHorizontal: 12,
                                    paddingVertical: 6,
                                    borderRadius: 8,
                                }}>
                                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "500" }}>Disapprove</Text>
                                </TouchableOpacity>

                                <TouchableOpacity onPress={() => startChat(item.user)} style={{ paddingVertical: 6, borderRadius: 8 }}>
                                    <Ionicons name="chatbubble" size={18} color="gray" />
                                </TouchableOpacity>
                            </View>
                        )}

                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? "#121212" : "#f5f5f5" }} edges={["top", "left", "right"]}>
            <View style={{
                backgroundColor: isDark ? "#1f1f1f" : "#fff",
                borderBottomWidth: 1,
                borderBottomColor: isDark ? "#333" : "#ddd",
                paddingVertical: 16,
                paddingHorizontal: 16,
            }}>
                <Text style={{ color: isDark ? "#fff" : "#000", fontSize: 20, fontWeight: "bold", textAlign: "center" }}>
                    Notifications
                </Text>
            </View>

            <FlatList
                data={notifications} 
                keyExtractor={(item) => item.id}
                renderItem={renderNotification}
                contentContainerStyle={{ paddingVertical: 8 }}
                // 🚨 ADD PULL-TO-REFRESH PROPS HERE
                onRefresh={handleRefresh}
                refreshing={isAnyRefetching}
            />

            <AlertDialog
                visible={confirmVisible}
                title="Delete Request"
                message="Are you sure you want to disapprove this request?"
                confirmText="Delete"
                cancelText="Cancel"
                destructive
                onConfirm={confirmDelete}
                onCancel={() => setConfirmVisible(false)}
            />
        </SafeAreaView>
    );
}