import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import MapView, { Marker } from "react-native-maps";
import { fetchPostsById, fetchPostsRequests } from "@/services/postService";
import { useSupabase } from "@/lib/supabase";
import DownloadImage from "@/components/download/downloadImage";
import DownloadPostImages from "@/components/download/downloadPostImages";
import { useUser } from "@clerk/clerk-expo";
import { insertRequestByUserId } from "@/services/requestService";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

// --- START: Conceptual Data Fetching for Landmarks ---
type Landmark = {
  name: string;
  icon: keyof typeof Ionicons.glyphMap; // Use Ionicons names for icons
  distance: string; 
  duration: string;
};

// 💡 NOTE: In a real app, this function would be in a service file and call a backend 
// API that internally queries a geospatial service (like Google Maps Places API) 
// using the provided latitude and longitude.
const fetchNearbyLandmarks = async (lat: number, lng: number): Promise<Landmark[]> => {
    // Simulated delay for network fetch
    // await new Promise(resolve => setTimeout(resolve, 500)); 

    // Mock data matching the user's provided screenshot structure
    return [
        { name: "ACE Medical Center", icon: "medkit-outline", distance: "2.3 km", duration: "8 mins" },
        { name: "SM City CDO", icon: "business-outline", distance: "3.1 km", duration: "12 mins" },
        { name: "Gaisano City Mall", icon: "business-outline", distance: "1.8 km", duration: "6 mins" },
        { name: "Puregold Carmen", icon: "cart-outline", distance: "0.9 km", duration: "4 mins" },
        { name: "Fire Station Carmen", icon: "flame-outline", distance: "1.2 km", duration: "5 mins" },
        { name: "USTP Campus", icon: "school-outline", distance: "4.5 km", duration: "15 mins" },
    ];
};
// --- END: Conceptual Data Fetching for Landmarks ---

export default function DetailPost() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const supabase = useSupabase();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const defaultAvatar = "https://i.pravatar.cc/150";

  // Fetch post details
  const { data: post, error, isLoading } = useQuery({
    queryKey: ["posts", id],
    queryFn: () => fetchPostsById(id as string, supabase),
    enabled: !!id,
  });
  
  // --- START: New Query for Landmarks ---
  const { data: nearbyLandmarks, isLoading: isLoadingLandmarks } = useQuery({
    // Only run query if post data is loaded and has coordinates
    queryKey: ["landmarks", post?.latitude, post?.longitude],
    queryFn: () => fetchNearbyLandmarks(post!.latitude!, post!.longitude!),
    enabled: !!post?.latitude && !!post?.longitude,
  });
  // --- END: New Query for Landmarks ---

  // Fetch all requests for this post
  const { data: postRequests, isLoading: isCheckingRequest } = useQuery({
    queryKey: ["request", id],
    queryFn: () => fetchPostsRequests(id as string, supabase),
    enabled: !!id,
  });

  const isOwnPost = userId === post?.post_user?.id;
  const isAvailable = !!post?.availability;

  // Request mutation
  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !id) throw new Error("User or post ID missing");
      return insertRequestByUserId(userId, id as string, supabase);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["request", id] }),
    onError: (err) => console.error("Failed to request post:", err),
  });

  const { mutate, isPending } = requestMutation;

  const handleRequestPost = () => {
    if (!isAvailable || isOwnPost) return;
    mutate();
  };

  // Button label logic (retains the logic from the previous turn)
  const [buttonLabel, setButtonLabel] = useState("Request Rental");
  const [buttonDisabled, setButtonDisabled] = useState(false);

  useEffect(() => {
    // Ensure postRequests is an array for consistent handling
    const requestsArray = postRequests 
      ? (Array.isArray(postRequests) ? postRequests : [postRequests])
      : [];
    
    const myRequest = requestsArray.find((req) => req.user_id === userId);
    // Check if ANY request exists that is NOT the current user's request
    const otherUserHasRequested = requestsArray.some((req) => req.user_id !== userId);

    if (!isAvailable || otherUserHasRequested) {
      setButtonLabel("Unavailable");
      setButtonDisabled(true);
      return;
    }

    if (myRequest) {
      if (myRequest.confirmed) {
        setButtonLabel("Approved / Stays");
        setButtonDisabled(true);
      } else if (myRequest.requested) {
        setButtonLabel("Acknowledged");
        setButtonDisabled(true);
      } else {
        setButtonLabel("Pending Request");
        setButtonDisabled(true);
      }
      return; 
    }
    
    setButtonLabel("Request Rental");
    setButtonDisabled(false);

  }, [postRequests, userId, isAvailable]);

  // Safe cast: only keep string filters from jsonb
  const filters: string[] = Array.isArray(post?.filters)
    ? post.filters.filter((f): f is string => typeof f === "string")
    : [];

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-black px-4 py-4">
        <Skeleton className="w-full h-64 rounded-lg mb-4" />
        <Skeleton className="w-1/3 h-6 rounded-full mb-2" />
        <Skeleton className="w-1/2 h-4 mb-2" />
        <Skeleton className="w-full h-20 rounded-lg mb-4" />
        <Skeleton className="w-full h-60 rounded-lg mb-4" />
        <Skeleton className="w-1/3 h-6 rounded-full mb-2" />
        <Skeleton className="w-full h-16 rounded-lg" />
      </SafeAreaView>
    );
  }

  if (error || !post) {
    return (
      <SafeAreaView className="flex-1 justify-center items-center bg-white dark:bg-black">
        <Text className="text-gray-900 dark:text-white text-lg font-medium">
          Post not found
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} className="px-2">
        {/* Image Header */}
        <View className="relative mb-4">
          {post.image ? (
            <DownloadPostImages
              path={post.image}
              supabase={supabase}
              fallbackUri={defaultAvatar}
              className="w-full h-64 rounded-xl shadow-lg"
            />
          ) : (
            <View className="w-full h-64 rounded-xl bg-gray-200 flex justify-center items-center shadow-lg">
              <Ionicons name="image-outline" size={60} color="#9CA3AF" />
            </View>
          )}
          <TouchableOpacity
            onPress={() => router.back()}
            className="absolute top-6 left-4 bg-black bg-opacity-50 rounded-full p-2"
          >
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* User Info + Chat */}
        <View className="flex-row justify-between items-center mb-4">
          {post.post_user && (
            <TouchableOpacity
              onPress={() => router.push(`/(user)/${post?.post_user?.id}`)}
              className="flex-row items-center flex-shrink"
            >
              {post.post_user.avatar ? (
                <DownloadImage
                  path={post.post_user.avatar}
                  supabase={supabase}
                  fallbackUri={defaultAvatar}
                  style={{ width: 50, height: 50, borderRadius: 50, marginRight: 12 }}
                />
              ) : (
                <View className="w-12 h-12 rounded-full bg-gray-300 mr-3" />
              )}
              <View>
                <Text className="text-sm font-semibold text-gray-900 dark:text-white">
                  {post.post_user.firstname || post.post_user.lastname
                    ? `${post.post_user.firstname ?? ""} ${post.post_user.lastname ?? ""}`.trim()
                    : post.post_user.username ?? "Stayvia User"}
                </Text>
                {post.created_at && (
                  <Text className="text-xs text-gray-500">
                    {new Date(post.created_at).toLocaleDateString()} ·{" "}
                    {new Date(post.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          {!isOwnPost && (
            <TouchableOpacity
              onPress={() => router.push(`/(chat)/chat`)}
              className="bg-blue-600 p-3 rounded-full shadow-md"
            >
              <Ionicons name="chatbubble" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        {/* Post Details */}
        <Text className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">{post.title}</Text>
        {post.location && <Text className="text-gray-500 mb-2 text-sm">📍 {post.location}</Text>}

        {post.latitude != null && post.longitude != null && (
          <View className="w-full h-60 rounded-xl overflow-hidden mb-4 shadow-md">
            <MapView
              style={{ flex: 1 }}
              initialRegion={{
                latitude: post.latitude,
                longitude: post.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
            >
              <Marker coordinate={{ latitude: post.latitude, longitude: post.longitude }} title={post.title} />
            </MapView>
          </View>
        )}

        {/* --- START: New Nearby Landmarks Section --- */}
        {post.latitude != null && post.longitude != null && (
          <View className="mb-6 border border-gray-100 dark:border-gray-800 rounded-xl p-4 shadow-lg">
            <Text className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Nearby Landmarks</Text>
            {isLoadingLandmarks ? (
                <View>
                    <Skeleton className="h-14 w-full mb-3 rounded-lg" />
                    <Skeleton className="h-14 w-full mb-3 rounded-lg" />
                    <Skeleton className="h-14 w-full mb-3 rounded-lg" />
                </View>
            ) : (
                nearbyLandmarks?.map((landmark, index) => (
                    <View key={index} className="flex-row items-center justify-between p-3 mb-2 rounded-lg bg-gray-50 dark:bg-gray-800">
                        <View className="flex-row items-center flex-1 pr-2">
                            <View className="p-2 rounded-full mr-3 bg-blue-100 dark:bg-blue-700/50">
                                <Ionicons name={landmark.icon} size={20} color="#3B82F6" />
                            </View>
                            <Text className="font-medium text-gray-900 dark:text-white flex-shrink">{landmark.name}</Text>
                        </View>
                        <View className="flex-row items-center ml-2">
                            {/* Distance */}
                            <Ionicons name="walk-outline" size={16} color="gray" style={{ marginRight: 4 }} />
                            <Text className="text-xs text-gray-500 mr-3">{landmark.distance}</Text>
                            {/* Duration */}
                            <Ionicons name="time-outline" size={16} color="gray" style={{ marginRight: 4 }} />
                            <Text className="text-xs text-gray-500">{landmark.duration}</Text>
                        </View>
                    </View>
                ))
            )}
          </View>
        )}
        {/* --- END: New Nearby Landmarks Section --- */}
        
        {post.price_per_night && (
          <Text className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
            Monthly: ₱ {post.price_per_night}
          </Text>
        )}

        {post.description && (
          <Text className="text-gray-800 dark:text-gray-200 mb-4">Post Details: {post.description}</Text>
        )}

        {/* Filters as badges */}
        {filters.length > 0 && (
        <>
          <Text className="dark:text-white mb-2">Filters:</Text>
          <View className="flex-row flex-wrap mb-6">
            {filters.map((filter, index) => (
              <Badge key={index} className="mr-2 mb-2 rounded-lg" variant="secondary">
                <Text className="dark:text-white">{filter}</Text>
              </Badge>

            ))}
          </View>
        </>
        )}
      </ScrollView>

      {/* Sticky Request Button */}
      {!isOwnPost && (
        <View className="absolute bottom-0 w-full px-4 py-4 bg-white dark:bg-black border-t border-gray-200 dark:border-gray-700">
          <TouchableOpacity
            disabled={buttonDisabled || isPending || isCheckingRequest}
            onPress={handleRequestPost}
            className={`py-4 rounded-xl ${
              buttonDisabled || isPending || isCheckingRequest
                ? "bg-gray-400"
                : "bg-blue-600"
            } shadow-lg flex-row justify-center items-center`}
          >
            {isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-center text-white font-semibold text-sm">
                {buttonLabel}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}