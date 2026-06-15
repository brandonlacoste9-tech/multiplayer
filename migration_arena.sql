-- Creates the RPC to grant points securely during gameplay

CREATE OR REPLACE FUNCTION public.grant_points(amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Ensure only authenticated players can earn points
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Add the points to their empire_points balance
  UPDATE public.profiles 
  SET empire_points = COALESCE(empire_points, 0) + amount 
  WHERE id = auth.uid();
END;
$$;
